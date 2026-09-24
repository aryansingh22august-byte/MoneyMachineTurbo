import axios from "axios";
import { addDays, subDays, format } from "date-fns";
import { getAllStocks, insertPrediction, insertAccuracyRecord } from "../db";

/**
 * Minimum signal strength required to open a backtest position.
 *
 * Worth understanding before tuning. From generateSignals:
 *   strength = |momentum| * 450 + technicalScore * 0.4 + 5
 * technicalScore realistically lands around 55–70, contributing 27–33. So the
 * old hardcoded threshold of 70 required |momentum| * 450 >= ~32, i.e. a
 * single-bar move of roughly 7–9%. On daily Nifty-50 bars that is close to
 * unreachable, so the backtest opened almost no positions and reported a 0%
 * win rate for nearly every symbol — which then propagated into the accuracy
 * figures shown across the dashboard.
 *
 * Override with BACKTEST_MIN_ENTRY_STRENGTH to tune without a code change.
 */
const MIN_ENTRY_STRENGTH = Number(process.env.BACKTEST_MIN_ENTRY_STRENGTH ?? 45);

let _backtestInterval: ReturnType<typeof setInterval> | null = null;

let backtestServiceStarted = false;
let backtestRunInProgress = false;

interface BacktestResult {
  stockId: number;
  symbol: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgGain: number;
  avgLoss: number;
}

interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  for (let i = period - 1; i < gains.length; i++) {
    const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }

  return rsi;
}

export function calculateMACD(prices: number[]): number[] {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd: number[] = [];

  const startIndex = 26 - 1; // Start from where both EMAs are available
  for (let i = 0; i < ema12.length && i < ema26.length; i++) {
    macd.push(ema12[i + (26 - 12)] - ema26[i]);
  }

  return macd;
}

function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  const firstSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(firstSMA);

  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(currentEMA);
  }

  return ema;
}

async function fetchHistoricalData(symbol: string, months: number = 12): Promise<HistoricalData[]> {
  try {
    const endDate = new Date();
    const startDate = subDays(endDate, months * 30);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const params = {
      period1: Math.floor(startDate.getTime() / 1000),
      period2: Math.floor(endDate.getTime() / 1000),
      interval: '1d',
      includePrePost: false,
    };

    const response = await axios.get(url, { params, timeout: 10000 });
    const data = response.data.chart.result[0];

    if (!data || !data.timestamp || !data.indicators.quote[0]) {
      return [];
    }

    const timestamps = data.timestamp;
    const quotes = data.indicators.quote[0];

    const historicalData: HistoricalData[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.open[i] && quotes.high[i] && quotes.low[i] && quotes.close[i]) {
        historicalData.push({
          date: format(new Date(timestamps[i] * 1000), 'yyyy-MM-dd'),
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i] || 0,
        });
      }
    }

    return historicalData;
  } catch (error) {
    console.error(`[Backtest] Failed to fetch historical data for ${symbol}:`, (error as Error)?.message);
    return [];
  }
}

/**
 * Right-align a trailing indicator series with the price series it came from,
 * so `aligned[i]` always describes `prices[i]`.
 *
 * Every indicator here is trailing — its last value corresponds to the last
 * price — but each has a different warm-up length (SMA(20) drops 19 bars,
 * SMA(50) drops 49, RSI(14) drops 14, MACD drops 25). The previous code
 * hand-wrote those offsets at each call site and got three of four wrong:
 *
 *   sma20[i - 20]  should have been i - 19  (off by one, read one bar stale)
 *   macd[i - 26]   should have been i - 25  (off by one, read one bar stale)
 *   sma50[i - 30]  should have been i - 49  — index i-30 maps to prices[i+19],
 *                  so the backtest was reading SMA(50) from NINETEEN BARS IN
 *                  THE FUTURE. That is look-ahead bias: it made every metric
 *                  derived from this function meaningless.
 *
 * Padding with `undefined` also means the warm-up region is explicitly absent
 * rather than silently falling through a `|| currentPrice` default.
 */
export function alignToPrices(series: number[], priceCount: number): (number | undefined)[] {
  const padding = priceCount - series.length;
  if (padding < 0) return series.slice(-priceCount);
  return [...new Array<number | undefined>(padding).fill(undefined), ...series];
}

function generateSignals(historicalData: HistoricalData[]): { date: string; signal: 'BUY' | 'SELL' | 'HOLD'; strength: number }[] {
  const closes = historicalData.map(d => d.close);
  const signals: { date: string; signal: 'BUY' | 'SELL' | 'HOLD'; strength: number }[] = [];

  if (closes.length < 50) return signals;

  // Aligned so index === price index; no manual offsets anywhere below.
  const sma20 = alignToPrices(calculateSMA(closes, 20), closes.length);
  const sma50 = alignToPrices(calculateSMA(closes, 50), closes.length);
  const rsi = alignToPrices(calculateRSI(closes), closes.length);
  const macd = alignToPrices(calculateMACD(closes), closes.length);

  for (let i = 1; i < historicalData.length; i++) {
    const sma20Val = sma20[i];
    const sma50Val = sma50[i];
    const rsiVal = rsi[i];
    const macdVal = macd[i];

    // Skip the warm-up region instead of substituting defaults — a synthetic
    // "neutral" reading is not a signal, and the old startIndex of 30 began
    // before SMA(50) was even defined.
    if (sma20Val === undefined || sma50Val === undefined || rsiVal === undefined || macdVal === undefined) {
      continue;
    }

    const currentPrice = closes[i];
    const prevPrice = closes[i - 1] || currentPrice;
    const momentum = prevPrice > 0 ? (currentPrice - prevPrice) / prevPrice : 0;

    const technicalScore = Math.round(
      Math.min(100, Math.max(0,
        (Math.min(Math.max(rsiVal / 70, 0), 1) * 40) +
        (Math.min(Math.max(sma20Val / (sma50Val || currentPrice), 0.9), 1.1) * 30) +
        (Math.min(Math.max(macdVal / currentPrice, -0.05), 0.05) * 600)
      ))
    );

    const predictedPrice = currentPrice * (1 + Math.min(Math.max(momentum, -0.03), 0.03));

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (predictedPrice > currentPrice * 1.01 && rsiVal < 75) signal = 'BUY';
    else if (predictedPrice < currentPrice * 0.99 && rsiVal > 35) signal = 'SELL';

    const strength = Math.round(
      Math.min(100, Math.max(0,
        Math.abs(momentum) * 1000 * 0.45 + (technicalScore / 100) * 40 + 5
      ))
    );

    signals.push({
      date: historicalData[i].date,
      signal,
      strength,
    });
  }

  return signals;
}

function calculateBacktestMetrics(signals: { date: string; signal: 'BUY' | 'SELL' | 'HOLD'; strength: number }[], historicalData: HistoricalData[]): BacktestResult {
  const trades: { entryDate: string; entryPrice: number; exitDate: string; exitPrice: number; pnl: number }[] = [];
  let position: 'BUY' | null = null;
  let entryPrice = 0;
  let entryDate = '';

  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const currentData = historicalData.find(d => d.date === signal.date);

    if (!currentData) continue;

    if (signal.signal === 'BUY' && position === null && signal.strength >= MIN_ENTRY_STRENGTH) {
      position = 'BUY';
      entryPrice = currentData.close;
      entryDate = signal.date;
    } else if (signal.signal === 'SELL' && position === 'BUY') {
      const exitPrice = currentData.close;
      const pnl = (exitPrice - entryPrice) / entryPrice;
      trades.push({
        entryDate,
        entryPrice,
        exitDate: signal.date,
        exitPrice,
        pnl,
      });
      position = null;
    }
  }

  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);

  const totalReturn = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

  // Calculate max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let runningReturn = 0;

  for (const trade of trades) {
    runningReturn += trade.pnl;
    if (runningReturn > peak) {
      peak = runningReturn;
    }
    const drawdown = peak - runningReturn;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate Sharpe ratio (simplified)
  const returns = trades.map(t => t.pnl);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1 ?
    Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / (returns.length - 1)) : 0;
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  const avgGain = winningTrades.length > 0 ?
    winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ?
    Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length) : 0;

  return {
    stockId: 0, // Will be set by caller
    symbol: '', // Will be set by caller
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: Math.round(winRate * 100),
    totalReturn: Math.round(totalReturn * 10000) / 100, // Convert to percentage
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    avgGain: Math.round(avgGain * 10000) / 100,
    avgLoss: Math.round(avgLoss * 10000) / 100,
  };
}

export async function runBacktestForStock(stockId: number, symbol: string): Promise<BacktestResult | null> {
  try {
    const historicalData = await fetchHistoricalData(symbol, 12); // 12 months of data

    if (historicalData.length < 100) {
      console.warn(`[Backtest] Insufficient data for ${symbol}: ${historicalData.length} days`);
      return null;
    }

    const signals = generateSignals(historicalData);
    const metrics = calculateBacktestMetrics(signals, historicalData);

    metrics.stockId = stockId;
    metrics.symbol = symbol;

    console.log(
      `[Backtest] ${symbol}: ${metrics.totalTrades} trades, ` +
      `${metrics.winRate}% win rate, ${metrics.totalReturn}% return`
    );

    // A run that opened no positions measured nothing. Recording isCorrect: 0
    // for it used to assert a failed prediction that was never made, dragging
    // every accuracy figure on the dashboard toward zero.
    if (metrics.totalTrades === 0) {
      console.warn(
        `[Backtest] ${symbol}: no positions opened (MIN_ENTRY_STRENGTH=${MIN_ENTRY_STRENGTH}) — ` +
        `not recording an accuracy row for a run with no trades`
      );
      return metrics;
    }

    // NOTE: these rows share the accuracyTracking table with live prediction
    // outcomes but carry predictionId 0 and actualSignal "BACKTEST". Nothing
    // currently resolves live predictions, so every accuracy figure in the app
    // is in practice sourced from backtests alone — see getAccuracyMetricsForStock
    // and getGlobalAccuracyMetrics.
    await insertAccuracyRecord({
      stockId,
      predictionId: 0, // backtest — no live predictionId
      actualSignal: "BACKTEST",
      isCorrect: metrics.winRate >= 50 ? 1 : 0,
      returnPercentage: metrics.totalReturn,
      resolutionDate: new Date().toISOString(),
    });

    return metrics;
  } catch (error) {
    console.error(`[Backtest] Failed for ${symbol}:`, error);
    return null;
  }
}

export async function runFullBacktest(): Promise<BacktestResult[]> {
  if (backtestRunInProgress) {
    console.warn('[Backtest] A backtest run is already in progress, skipping duplicate request');
    return [];
  }

  backtestRunInProgress = true;
  try {
    const stocks = await getAllStocks();
    const results: BacktestResult[] = [];

    for (const stock of stocks) {
      const result = await runBacktestForStock(stock.id, stock.symbol);
      if (result) {
        results.push(result);
      }
      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return results;
  } finally {
    backtestRunInProgress = false;
  }
}

export async function getBacktestSummary(results: BacktestResult[]) {
  if (results.length === 0) return null;

  const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;
  const avgTotalReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
  const avgSharpeRatio = results.reduce((sum, r) => sum + r.sharpeRatio, 0) / results.length;

  const bestPerforming = results.reduce((best, current) =>
    current.totalReturn > best.totalReturn ? current : best
  );

  const worstPerforming = results.reduce((worst, current) =>
    current.totalReturn < worst.totalReturn ? current : worst
  );

  return {
    totalStocks: results.length,
    avgWinRate: Math.round(avgWinRate),
    avgTotalReturn: Math.round(avgTotalReturn * 100) / 100,
    avgSharpeRatio: Math.round(avgSharpeRatio * 100) / 100,
    bestStock: bestPerforming.symbol,
    bestReturn: bestPerforming.totalReturn,
    worstStock: worstPerforming.symbol,
    worstReturn: worstPerforming.totalReturn,
  };
}

export async function startBacktestService() {
  if (_backtestInterval) {
    console.warn('[Backtest] Service already started — ignoring duplicate start');
    return;
  }

  backtestServiceStarted = true;

  // Run weekly backtests — stored so we can clear on shutdown
  _backtestInterval = setInterval(async () => {
    console.log('[Backtest] Starting weekly backtest...');
    const results = await runFullBacktest();
    const summary = await getBacktestSummary(results);

    if (summary) {
      console.log('[Backtest] Summary:', summary);

      // Store results in database or log for analysis
      // This could be extended to store historical backtest results
    }
  }, 7 * 24 * 60 * 60 * 1000); // Weekly

  // Initial run
  setTimeout(async () => {
    const results = await runFullBacktest();
    const summary = await getBacktestSummary(results);
    if (summary) {
      console.log('[Backtest] Initial backtest completed:', summary);
    }
  }, 30000); // Run after 30 seconds on startup
}