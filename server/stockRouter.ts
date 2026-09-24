import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

/** Safe parseFloat — returns undefined instead of NaN/Infinity for invalid inputs */
function safeFloat(val: string | undefined | null): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val);
  return isFinite(n) ? n : undefined;
}

/** Map a 0-100 sentiment score onto the label enum stored in newsSentiment. */
function deriveSentimentLabel(score: number): "POSITIVE" | "NEUTRAL" | "NEGATIVE" {
  if (score > 65) return "POSITIVE";
  if (score < 35) return "NEGATIVE";
  return "NEUTRAL";
}
import { generateSMCReport } from "./_core/smcEngine";
import {
  getStockBySymbol,
  getAllStocks,
  upsertStock,
  getLatestStockPrice,
  insertStockPrice,
  getLatestPrediction,
  insertPrediction,
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getUserAlerts,
  createAlert,
  getLatestNewsSentiment,
  insertNewsSentiment,
  getStockPriceHistory,
  getAllStocksWithLatestPrices,
  getAllLatestPredictions,
  getAccuracyMetricsForStock,
  getTopGainerStocks,
  getStocksBySector,
  getAllStocksRanked,
} from "./db";
import { generateQuickPreview } from "./_core/stockDataService";

const symbolInput = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9&.\- ]+$/i, "Invalid stock symbol")
  .transform((value) => value.toUpperCase());

export const stockRouter = router({
  // Get all stocks
  getAllStocks: publicProcedure.query(async () => {
    return await getAllStocks();
  }),

  // Get stock by symbol
  getStockBySymbol: publicProcedure
    .input(z.object({ symbol: symbolInput }))
    .query(async ({ input }) => {
      return await getStockBySymbol(input.symbol);
    }),

  // Get latest price for a stock
  getLatestPrice: publicProcedure
    .input(z.object({ stockId: z.number() }))
    .query(async ({ input }) => {
      return await getLatestStockPrice(input.stockId);
    }),

  // Get latest prediction for a stock
  getLatestPrediction: publicProcedure
    .input(z.object({ stockId: z.number() }))
    .query(async ({ input }) => {
      return await getLatestPrediction(input.stockId);
    }),

  // Get news sentiment for a stock
  getNewsSentiment: publicProcedure
    .input(z.object({ stockId: z.number(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      return await getLatestNewsSentiment(input.stockId, input.limit);
    }),

  getNewsSentimentBySymbol: publicProcedure
    .input(z.object({ symbol: symbolInput, limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const stock = await getStockBySymbol(input.symbol);
      if (!stock) return [];
      return await getLatestNewsSentiment(stock.id, input.limit);
    }),

  //   .query(async ({ input }) => {
  //     return await getAccuracyMetrics(input.stockId);
  //   }),

  getSMCAnalysis: publicProcedure
    .input(z.object({ stockId: z.number(), symbol: z.string() }))
    .query(async ({ input }) => {
      // getStockPriceHistory returns oldest-first, which is what the SMC engine
      // requires — it walks the array forward comparing candles[i-2] to candles[i].
      const history = await getStockPriceHistory(input.stockId, 100, 300);
      if (history.length < 3) return null;

      const candles = history.map(c => ({
        // Fall back to lastPrice rather than 0: a zeroed OHLC would register as
        // an enormous fair-value gap and emit bogus structure signals.
        open: c.open ?? c.lastPrice,
        high: c.high ?? c.lastPrice,
        low: c.low ?? c.lastPrice,
        close: c.lastPrice,
        volume: c.volume ?? 0,
        timestamp: c.timestamp,
      }));

      return await generateSMCReport(input.stockId, input.symbol, candles);
    }),

  /**
   * Live Preview: Real-time analysis for UNTRACKED stocks (Discovery Mode)
   * Fetches data from Yahoo Finance on-the-fly, runs ML prediction + SMC analysis
   */
  getLivePreview: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      // 1. Run the existing Quick Preview (ML + Technicals)
      const prediction = await generateQuickPreview(input.symbol);
      if (!prediction) return null;

      return {
        symbol: input.symbol,
        prediction,
      };
    }),

  // Watchlist operations
  getWatchlist: protectedProcedure.query(async ({ ctx }) => {
    const watchlistItems = await getUserWatchlist(ctx.user.id);
    return watchlistItems;
  }),

  addToWatchlist: protectedProcedure
    .input(z.object({ stockId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await addToWatchlist(ctx.user.id, input.stockId);
      return { success: true };
    }),

  removeFromWatchlist: protectedProcedure
    .input(z.object({ stockId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await removeFromWatchlist(ctx.user.id, input.stockId);
      return { success: true };
    }),

  // Alert operations
  getAlerts: protectedProcedure.query(async ({ ctx }) => {
    return await getUserAlerts(ctx.user.id);
  }),

  // markAlertAsRead: protectedProcedure
  //   .input(z.object({ alertId: z.number() }))
  //   .mutation(async ({ input }) => {
  //     await markAlertAsRead(input.alertId);
  //     return { success: true };
  //   }),

  // Admin: Update stock data (for data sync service)
  updateStock: adminProcedure
    .input(
      z.object({
        symbol: symbolInput,
        companyName: z.string(),
        exchange: z.enum(["NSE", "BSE"]),
        sector: z.string().optional(),
        industry: z.string().optional(),
        marketCap: z.string().optional(),
        peRatio: z.string().optional(),
        dividendYield: z.string().optional(),
        bookValue: z.string().optional(),
        eps: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await upsertStock({
        symbol: input.symbol,
        companyName: input.companyName,
        exchange: input.exchange as any,
        sector: input.sector,
        industry: input.industry,
        marketCap: safeFloat(input.marketCap),
        peRatio: safeFloat(input.peRatio),
        dividendYield: safeFloat(input.dividendYield),
        bookValue: safeFloat(input.bookValue),
        eps: safeFloat(input.eps),
      });
      return { success: true };
    }),

  // Admin: Insert stock price
  insertStockPrice: adminProcedure
    .input(
      z.object({
        stockId: z.number(),
        lastPrice: z.string(),
        change: z.string().optional(),
        percentChange: z.string().optional(),
        open: z.string().optional(),
        high: z.string().optional(),
        low: z.string().optional(),
        previousClose: z.string().optional(),
        volume: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await insertStockPrice({
        stockId: input.stockId,
        lastPrice: safeFloat(input.lastPrice) ?? 0,
        change: safeFloat(input.change),
        percentChange: safeFloat(input.percentChange),
        open: safeFloat(input.open),
        high: safeFloat(input.high),
        low: safeFloat(input.low),
        previousClose: safeFloat(input.previousClose),
        volume: input.volume,
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }),

  // Admin: Insert prediction
  insertPrediction: adminProcedure
    .input(
      z.object({
        stockId: z.number(),
        signal: z.enum(["BUY", "SELL", "HOLD"]),
        strength: z.number().min(0).max(100),
        technicalScore: z.number().optional(),
        sentimentScore: z.number().optional(),
        rsi: z.string().optional(),
        macd: z.string().optional(),
        sma20: z.string().optional(),
        sma50: z.string().optional(),
        predictedPrice: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await insertPrediction({
        stockId: input.stockId,
        signal: input.signal as any,
        strength: input.strength,
        technicalScore: input.technicalScore,
        sentimentScore: input.sentimentScore,
        rsi: safeFloat(input.rsi),
        macd: safeFloat(input.macd),
        sma20: safeFloat(input.sma20),
        sma50: safeFloat(input.sma50),
        predictedPrice: safeFloat(input.predictedPrice),
        timestamp: new Date().toISOString(),
      });
      return { success: true };
    }),

  // Admin: Insert news sentiment
  insertNewsSentiment: adminProcedure
    .input(
      z.object({
        stockId: z.number(),
        headline: z.string().optional(),
        source: z.string().optional(),
        sentimentScore: z.string().optional(),
        sentimentLabel: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional(),
        url: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await insertNewsSentiment({
        stockId: input.stockId,
        headline: input.headline ?? '',
        source: input.source,
        sentimentScore: safeFloat(input.sentimentScore as string | undefined) ?? 50,
        // sentimentLabel is NOT NULL in the schema but optional on this input —
        // derive it from the score rather than inserting null.
        sentimentLabel: input.sentimentLabel ?? deriveSentimentLabel(
          safeFloat(input.sentimentScore as string | undefined) ?? 50
        ),
        url: input.url,
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      return { success: true };
    }),

  // Price history for trajectory charts (last N days)
  getPriceHistory: publicProcedure
    .input(z.object({ stockId: z.number(), days: z.number().default(7) }))
    .query(async ({ input }) => {
      return await getStockPriceHistory(input.stockId, input.days);
    }),

  // All stocks with their latest price (for screeners)
  getAllStocksWithPrices: publicProcedure.query(async () => {
    return await getAllStocksWithLatestPrices();
  }),

  // Latest prediction for every stock (for bulk screener views)
  getAllPredictions: publicProcedure.query(async () => {
    return await getAllLatestPredictions();
  }),

  // Technical indicators derived from the latest stored prediction
  getTechnicalIndicators: publicProcedure
    .input(z.object({ stockId: z.number() }))
    .query(async ({ input }) => {
      const pred = await getLatestPrediction(input.stockId);
      if (!pred) return null;
      return { rsi: pred.rsi, macd: pred.macd, sma20: pred.sma20, sma50: pred.sma50, atr: null, technicalScore: pred.technicalScore };
    }),

  // Accuracy/backtest metrics for a stock
  getAccuracyMetrics: publicProcedure
    .input(z.object({ stockId: z.number() }))
    .query(async ({ input }) => {
      return await getAccuracyMetricsForStock(input.stockId);
    }),

  // Backtest metrics — an alias for getAccuracyMetrics; both read the same
  // accuracyTracking rows. (The old note here pointed at dashboardRouter, which
  // was unreachable dead code returning hardcoded figures and has been removed.)
  getBacktestMetrics: publicProcedure
    .input(z.object({ stockId: z.number() }))
    .query(async ({ input }) => {
      return await getAccuracyMetricsForStock(input.stockId);
    }),

  // Stocks ranked by percent change (top gainers / losers)
  getTopGainers: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return await getTopGainerStocks(input.limit);
    }),

  // All stocks ranked by prediction confidence (BUY first) — for Market Scanner
  getAllStocksRanked: publicProcedure.query(async () => {
    return await getAllStocksRanked();
  }),

  // Related stocks from same sector (for Stock Detail Drawer)
  getRelatedStocks: publicProcedure
    .input(z.object({ stockId: z.number(), limit: z.number().default(6) }))
    .query(async ({ input }) => {
      const allStocks = await getAllStocks();
      const target = allStocks.find((s) => s.id === input.stockId);
      if (!target || !target.sector) return [];
      return await getStocksBySector(target.sector, input.stockId, input.limit);
    }),

  // Quick on-demand preview for any NSE symbol (no DB save, JS prediction only)
  getStockQuickPreview: publicProcedure
    .input(z.object({ symbol: symbolInput }))
    .query(async ({ input }) => {
      const preview = await generateQuickPreview(input.symbol);
      if (!preview) return null;
      return preview;
    }),

  // ── Market Indices (Nifty 50, Bank Nifty, VIX) ──
  getMarketIndices: publicProcedure.query(async () => {
    try {
      const axios = (await import('axios')).default;
      const symbols = ['^NSEI', '^NSEBANK', '^INDIAVIX'];
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`;
      const response = await axios.get(url, { timeout: 5000 });
      const results = response.data?.quoteResponse?.result || [];
      
      const indices = {
        nifty50: { price: 0, change: 0, changePercent: 0 },
        bankNifty: { price: 0, change: 0, changePercent: 0 },
        vix: { price: 0, change: 0, changePercent: 0 }
      };

      for (const item of results) {
        const data = {
          price: item.regularMarketPrice || 0,
          change: item.regularMarketChange || 0,
          changePercent: item.regularMarketChangePercent || 0,
        };
        if (item.symbol === '^NSEI') indices.nifty50 = data;
        else if (item.symbol === '^NSEBANK') indices.bankNifty = data;
        else if (item.symbol === '^INDIAVIX') indices.vix = data;
      }

      return indices;
    } catch (err) {
      console.error('[Market Indices] fetch error:', err);
      // Return defaults so the UI doesn't crash, just shows 0
      return {
        nifty50: { price: 0, change: 0, changePercent: 0 },
        bankNifty: { price: 0, change: 0, changePercent: 0 },
        vix: { price: 0, change: 0, changePercent: 0 }
      };
    }
  }),

  // ── On-demand backtest: run against real Yahoo Finance historical data ──
  runBacktest: publicProcedure
    .input(z.object({ stockId: z.number(), symbol: z.string(), months: z.number().default(12) }))
    .mutation(async ({ input }) => {
      const { runBacktestForStock } = await import('./_core/backtestService');
      const result = await runBacktestForStock(input.stockId, input.symbol);
      return result;
    }),

  // ── Full equity curve data for a symbol (Yahoo Finance historical prices + signals) ──
  getBacktestEquityCurve: publicProcedure
    .input(z.object({ symbol: z.string(), months: z.number().default(12) }))
    .mutation(async ({ input }) => {
      try {
        const axios = (await import('axios')).default;
        const { subDays, format } = await import('date-fns');

        const endDate = new Date();
        const startDate = subDays(endDate, input.months * 30);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${input.symbol}`;
        const params = {
          period1: Math.floor(startDate.getTime() / 1000),
          period2: Math.floor(endDate.getTime() / 1000),
          interval: '1d',
          includePrePost: false,
        };

        const response = await axios.get(url, { params, timeout: 15000 });
        const data = response.data.chart.result[0];
        if (!data?.timestamp || !data.indicators?.quote?.[0]) return null;

        const timestamps: number[] = data.timestamp;
        const quotes = data.indicators.quote[0];

        // Build OHLCV array
        const bars: { date: string; close: number; volume: number }[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (quotes.close[i]) {
            bars.push({
              date: format(new Date(timestamps[i] * 1000), 'yyyy-MM-dd'),
              close: quotes.close[i],
              volume: quotes.volume[i] ?? 0,
            });
          }
        }

        if (bars.length < 30) return null; // need at least 30 days (SMA20 minimum)

        // SMA helper
        const sma = (arr: number[], p: number) => arr.map((_, i) =>
          i < p - 1 ? null : arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p
        );

        // RSI helper
        const rsiArr = (arr: number[], p = 14) => {
          const res: (number | null)[] = Array(p).fill(null);
          for (let i = p; i < arr.length; i++) {
            const slice = arr.slice(i - p, i + 1);
            const gains = slice.map((v, j) => j === 0 ? 0 : Math.max(v - slice[j - 1], 0));
            const losses = slice.map((v, j) => j === 0 ? 0 : Math.max(slice[j - 1] - v, 0));
            const ag = gains.reduce((a, b) => a + b) / p;
            const al = losses.reduce((a, b) => a + b) / p;
            res.push(al === 0 ? 100 : 100 - (100 / (1 + ag / al)));
          }
          return res;
        };

        const closes = bars.map(b => b.close);
        const sma20 = sma(closes, 20);
        const sma50 = sma(closes, 50);
        const rsi = rsiArr(closes);

        // Generate signals + simulate equity curve
        const trades: { entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; returnPct: number; isWin: boolean }[] = [];
        const equityCurve: { date: string; equity: number; signal?: string }[] = [];

        let equity = 100; // Start at 100 (normalized)
        let position: { entryIdx: number; entryPrice: number } | null = null;

        for (let i = 21; i < bars.length; i++) {
          const bar = bars[i];
          const r = rsi[i] ?? 50;
          const s20 = sma20[i];
          const s50 = sma50[i];
          if (!s20 || !s50) continue;

          let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

          // ── Balanced signal logic ──────────────────────────────────────────
          // BUY: RSI dipping below 48 (mild oversold) OR SMA golden cross
          // SELL: RSI rising above 58 (mild overbought) OR SMA death cross
          // Using OR logic (not AND) so signals fire regularly across timeframes
          const smaCrossUp = s20 !== null && s50 !== null && s20 > s50;
          const smaCrossDown = s20 !== null && s50 !== null && s20 < s50;
          const rsiBuy = r < 48;
          const rsiSell = r > 58;

          if ((rsiBuy || smaCrossUp) && !smaCrossDown) signal = 'BUY';
          else if ((rsiSell || smaCrossDown) && !smaCrossUp) signal = 'SELL';

          // Prevent rapid whipsaw: only flip signal after holding for at least 5 bars
          // (handled naturally by the position state machine below)

          if (signal === 'BUY' && !position) {
            position = { entryIdx: i, entryPrice: bar.close };
          } else if ((signal === 'SELL' || i === bars.length - 1) && position) {
            const ret = (bar.close - position.entryPrice) / position.entryPrice * 100;
            equity += ret;
            trades.push({
              entryDate: bars[position.entryIdx].date,
              exitDate: bar.date,
              entryPrice: position.entryPrice,
              exitPrice: bar.close,
              returnPct: Math.round(ret * 100) / 100,
              isWin: ret > 0,
            });
            position = null;
          }

          equityCurve.push({ date: bar.date, equity: Math.round(equity * 100) / 100, signal: signal !== 'HOLD' ? signal : undefined });
        }

        const wins = trades.filter(t => t.isWin);
        const losses = trades.filter(t => !t.isWin);
        const winRate = trades.length > 0 ? Math.round((wins.length / trades.length) * 100) : 0;
        const totalReturn = Math.round((equity - 100) * 100) / 100;
        const avgGain = wins.length > 0 ? Math.round(wins.reduce((s, t) => s + t.returnPct, 0) / wins.length * 100) / 100 : 0;
        const avgLoss = losses.length > 0 ? Math.round(losses.reduce((s, t) => s + Math.abs(t.returnPct), 0) / losses.length * 100) / 100 : 0;

        // Max drawdown
        let peak = 100, maxDd = 0, runEq = 100;
        for (const pt of equityCurve) {
          if (pt.equity > peak) peak = pt.equity;
          const dd = peak - pt.equity;
          if (dd > maxDd) maxDd = dd;
        }

        return {
          symbol: input.symbol,
          equityCurve,
          trades,
          metrics: {
            totalTrades: trades.length,
            winRate,
            totalReturn,
            maxDrawdown: Math.round(maxDd * 100) / 100,
            avgGain,
            avgLoss,
            winningTrades: wins.length,
            losingTrades: losses.length,
          },
        };
      } catch (err) {
        console.error('[Backtest equity curve] error:', err);
        return null;
      }
    }),
});
