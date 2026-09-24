/**
 * smcEngine.ts
 * Core logic for Smart Money Concepts (SMC) Institutional Analysis
 * Includes: FVG, Liquidity Sweeps, Anchored VWAP, and Market Structure
 */

export interface FVG {
  id: string;
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
  mitigated: boolean;
  timestamp: string;
}

export interface LiquiditySweep {
  price: number;
  type: 'high' | 'low';
  timestamp: string;
}

export interface MarketStructure {
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  price: number;
  timestamp: string;
}

export interface SMCReport {
  stockId: number;
  symbol: string;
  fvgs: FVG[];
  sweeps: LiquiditySweep[];
  structures: MarketStructure[];
  anchoredVwap?: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  timestamp: string;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

/**
 * Detects Fair Value Gaps (FVG) in a candle array
 * Logic: A gap between Candle[i-2].High and Candle[i].Low (Bullish)
 * or Candle[i-2].Low and Candle[i].High (Bearish)
 */
export function detectFVGs(candles: Candle[]): FVG[] {
  if (candles.length < 3) return [];
  const fvgs: FVG[] = [];

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1]; // The "Big" candle
    const c3 = candles[i];

    // Bullish FVG (Gap Up)
    if (c1.high < c3.low && c2.close > c2.open) {
      fvgs.push({
        id: `fvg-bull-${c2.timestamp}`,
        top: c3.low,
        bottom: c1.high,
        type: 'bullish',
        mitigated: false,
        timestamp: c2.timestamp
      });
    }

    // Bearish FVG (Gap Down)
    if (c1.low > c3.high && c2.close < c2.open) {
      fvgs.push({
        id: `fvg-bear-${c2.timestamp}`,
        top: c1.low,
        bottom: c3.high,
        type: 'bearish',
        mitigated: false,
        timestamp: c2.timestamp
      });
    }
  }

  // Check mitigation against the latest candle
  const latestPrice = candles[candles.length - 1].close;
  return fvgs.map(fvg => {
    if (fvg.type === 'bullish' && latestPrice <= fvg.bottom) return { ...fvg, mitigated: true };
    if (fvg.type === 'bearish' && latestPrice >= fvg.top) return { ...fvg, mitigated: true };
    return fvg;
  });
}

/**
 * Detects Liquidity Sweeps
 * Logic: Price breaches a recent swing high/low and reverses
 */
export function detectLiquiditySweeps(candles: Candle[], lookback = 20): LiquiditySweep[] {
  if (candles.length < lookback + 1) return [];
  const sweeps: LiquiditySweep[] = [];

  const slice = candles.slice(-lookback - 1, -1);
  const swingHigh = Math.max(...slice.map(c => c.high));
  const swingLow  = Math.min(...slice.map(c => c.low));

  const latest = candles[candles.length - 1];

  // High Sweep (Bearish reversal)
  if (latest.high > swingHigh && latest.close < swingHigh) {
    sweeps.push({
      price: swingHigh,
      type: 'high',
      timestamp: latest.timestamp
    });
  }

  // Low Sweep (Bullish reversal)
  if (latest.low < swingLow && latest.close > swingLow) {
    sweeps.push({
      price: swingLow,
      type: 'low',
      timestamp: latest.timestamp
    });
  }

  return sweeps;
}

/**
 * Calculates Anchored VWAP
 * Logic: Cumulative (Price * Volume) / Cumulative Volume starting from anchor
 */
export function calculateAnchoredVWAP(candles: Candle[], anchorTimestamp: string): number | undefined {
  let totalPV = 0;
  let totalV = 0;
  let found = false;

  for (const c of candles) {
    if (c.timestamp >= anchorTimestamp) {
      found = true;
      const typicalPrice = (c.high + c.low + c.close) / 3;
      totalPV += typicalPrice * c.volume;
      totalV += c.volume;
    }
  }

  return found && totalV > 0 ? totalPV / totalV : undefined;
}

/**
 * Detects Market Structure (BoS and CHoCH)
 * Logic: 
 * - BoS: Price breaks recent high/low in direction of trend
 * - CHoCH: Price breaks the previous major structural low/high (reversal)
 */
export function detectMarketStructure(candles: Candle[]): MarketStructure[] {
  if (candles.length < 50) return [];
  const structures: MarketStructure[] = [];
  
  // 1. Identify Swing Points (Fractals)
  const lookback = 5;
  const swings: { price: number, type: 'high' | 'low', timestamp: string }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const isHigh = candles.slice(i - lookback, i).every(x => x.high <= c.high) &&
                   candles.slice(i + 1, i + lookback + 1).every(x => x.high <= c.high);
    const isLow  = candles.slice(i - lookback, i).every(x => x.low >= c.low) &&
                   candles.slice(i + 1, i + lookback + 1).every(x => x.low >= c.low);
    if (isHigh) swings.push({ price: c.high, type: 'high', timestamp: c.timestamp });
    if (isLow)  swings.push({ price: c.low,  type: 'low',  timestamp: c.timestamp });
  }

  if (swings.length < 4) return [];

  // 2. Track Structure Evolution
  let currentTrend: 'bullish' | 'bearish' = swings[1].price > swings[0].price ? 'bullish' : 'bearish';
  let lastHigh = swings.filter(s => s.type === 'high').pop()?.price ?? 0;
  let lastLow  = swings.filter(s => s.type === 'low').pop()?.price ?? 0;

  // We look at the most recent 20 candles to see if we've broken anything
  const recentCandles = candles.slice(-20);
  for (const c of recentCandles) {
    // Bullish BoS: Breaking Higher High in Uptrend
    if (currentTrend === 'bullish' && c.close > lastHigh) {
      structures.push({
        type: 'BOS',
        direction: 'bullish',
        price: lastHigh,
        timestamp: c.timestamp
      });
      lastHigh = c.high; // Reset anchor
    }

    // Bearish CHoCH: Breaking Higher Low in Uptrend (Reversal Sign)
    if (currentTrend === 'bullish' && c.close < lastLow) {
      structures.push({
        type: 'CHoCH',
        direction: 'bearish',
        price: lastLow,
        timestamp: c.timestamp
      });
      currentTrend = 'bearish';
      lastLow = c.low;
    }

    // Bearish BoS: Breaking Lower Low in Downtrend
    if (currentTrend === 'bearish' && c.close < lastLow) {
      structures.push({
        type: 'BOS',
        direction: 'bearish',
        price: lastLow,
        timestamp: c.timestamp
      });
      lastLow = c.low;
    }

    // Bullish CHoCH: Breaking Lower High in Downtrend (Reversal Sign)
    if (currentTrend === 'bearish' && c.close > lastHigh) {
      structures.push({
        type: 'CHoCH',
        direction: 'bullish',
        price: lastHigh,
        timestamp: c.timestamp
      });
      currentTrend = 'bullish';
      lastHigh = c.high;
    }
  }

  return structures;
}

/**
 * Generates a complete SMC Report for a stock
 */
export async function generateSMCReport(stockId: number, symbol: string, candles: Candle[]): Promise<SMCReport> {
  const fvgs = detectFVGs(candles);
  const sweeps = detectLiquiditySweeps(candles);
  const structures = detectMarketStructure(candles);
  
  // Anchor to 09:15 AM IST (UTC 03:45)
  const today = new Date().toISOString().split('T')[0];
  const anchor = `${today}T03:45:00.000Z`;
  const avwap = calculateAnchoredVWAP(candles, anchor);

  // Advanced Bias logic
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  const latestPrice = candles[candles.length - 1].close;
  const latestStructure = structures[structures.length - 1];
  
  if (latestStructure) {
    bias = latestStructure.direction;
  } else if (avwap) {
    bias = latestPrice > avwap ? 'bullish' : 'bearish';
  }

  return {
    stockId,
    symbol,
    fvgs: fvgs.filter(f => !f.mitigated).slice(-5),
    sweeps: sweeps.slice(-3),
    structures: structures.slice(-3),
    anchoredVwap: avwap,
    bias,
    timestamp: new Date().toISOString()
  };
}
