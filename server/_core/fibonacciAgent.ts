/**
 * fibonacciAgent.ts
 * Fibonacci-EMA Intelligence Agent for Money Machine dashboard.
 * Computes: swing points → Fib retracement/extension → EMA stack (9/21/50/100/200)
 * → confluence zones → candlestick patterns → RSI/MACD divergence → VWAP → agent vote
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OHLCV {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  date: string;
}

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
  levelType: 'retracement' | 'extension';
  zoneType: 'support' | 'resistance';
}

export interface EMAStack {
  ema9: number;
  ema21: number;
  ema50: number;
  ema100: number;
  ema200: number;
  trend: 'BULLISH' | 'BEARISH' | 'MIXED';
}

export interface ConfluenceZone {
  priceCenter: number;
  priceLow: number;
  priceHigh: number;
  fibRatio: number;
  emaPeriod: number | null;
  strength: number; // 1-5
  zoneType: 'support' | 'resistance';
}

export interface CandlePattern {
  name: string;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  reliability: number; // 0-1
}

export interface DivergenceResult {
  type: 'BULLISH' | 'BEARISH' | 'NONE';
  indicator: 'RSI' | 'MACD' | 'NONE';
  strength: number; // 0-1
}

export interface FibReliabilityMap {
  [ratio: string]: { bounceRate: number; sampleSize: number };
}

export interface FibAgentVote {
  persona: 'Fibonacci-EMA Agent';
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-1
  reasoning: string;
  fibLevels: FibLevel[];
  emaStack: EMAStack;
  confluenceZones: ConfluenceZone[];
  nearestZone: ConfluenceZone | null;
  candlePattern: CandlePattern;
  divergence: DivergenceResult;
  vwap: number;
  isAboveVwap: boolean;
  entryZone: [number, number] | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  alertTier: 'APPROACHING' | 'AT_ZONE' | 'TRIGGERED' | 'NONE';
  swingHigh: number;
  swingLow: number;
}

// ── EMA Calculation ────────────────────────────────────────────────────────────

function calcEMASeries(prices: number[], period: number): number[] {
  if (prices.length < period) return prices.map(() => prices[0] ?? 0);
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) result.push(ema);
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcEMA(prices: number[], period: number): number {
  const series = calcEMASeries(prices, period);
  return series[series.length - 1] ?? prices[prices.length - 1] ?? 0;
}

// ── EMA Stack ─────────────────────────────────────────────────────────────────

export function calcEMAStack(closes: number[]): EMAStack {
  const ema9   = calcEMA(closes, 9);
  const ema21  = calcEMA(closes, 21);
  const ema50  = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcEMA(closes, 200);

  let trend: EMAStack['trend'];
  if (ema9 > ema21 && ema21 > ema50 && ema50 > ema200) trend = 'BULLISH';
  else if (ema9 < ema21 && ema21 < ema50 && ema50 < ema200) trend = 'BEARISH';
  else trend = 'MIXED';

  return { ema9, ema21, ema50, ema100, ema200, trend };
}

// ── Swing Point Detection (Fractal) ───────────────────────────────────────────

export function detectSwingPoints(candles: OHLCV[], lookback = 5): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const isSwingHigh = candles.slice(i - lookback, i).every(x => x.high <= c.high)
                     && candles.slice(i + 1, i + lookback + 1).every(x => x.high <= c.high);
    const isSwingLow  = candles.slice(i - lookback, i).every(x => x.low >= c.low)
                     && candles.slice(i + 1, i + lookback + 1).every(x => x.low >= c.low);
    if (isSwingHigh) swings.push({ index: i, price: c.high, type: 'high', date: c.timestamp });
    if (isSwingLow)  swings.push({ index: i, price: c.low,  type: 'low',  date: c.timestamp });
  }
  // Return last 8 swing points
  return swings.slice(-8);
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────

const FIB_RETRACE_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const FIB_EXTEND_RATIOS  = [1.0, 1.272, 1.618, 2.0, 2.618];

export function calcFibRetracement(swingHigh: number, swingLow: number, uptrend: boolean): FibLevel[] {
  const range = swingHigh - swingLow;
  return FIB_RETRACE_RATIOS.map(r => {
    const price = uptrend ? swingHigh - range * r : swingLow + range * r;
    return {
      ratio: r,
      price: parseFloat(price.toFixed(2)),
      label: `${(r * 100).toFixed(1)}%`,
      levelType: 'retracement' as const,
      zoneType: (uptrend ? 'support' : 'resistance') as 'support' | 'resistance',
    };
  });
}

export function calcFibExtension(swingLow: number, swingHigh: number, retraceLow: number): FibLevel[] {
  const range = swingHigh - swingLow;
  return FIB_EXTEND_RATIOS.map(r => {
    const price = retraceLow + range * r;
    return {
      ratio: r,
      price: parseFloat(price.toFixed(2)),
      label: `${(r * 100).toFixed(1)}% Ext`,
      levelType: 'extension' as const,
      zoneType: 'resistance' as const,
    };
  });
}

// ── Confluence Zone Detection ─────────────────────────────────────────────────

export function findConfluenceZones(
  fibLevels: FibLevel[],
  emaStack: EMAStack,
  currentPrice: number,
  tolerancePct = 0.01
): ConfluenceZone[] {
  const tolerance = currentPrice * tolerancePct;
  const zones: ConfluenceZone[] = [];
  const emaValues = [
    { period: 9,   price: emaStack.ema9   },
    { period: 21,  price: emaStack.ema21  },
    { period: 50,  price: emaStack.ema50  },
    { period: 100, price: emaStack.ema100 },
    { period: 200, price: emaStack.ema200 },
  ];

  for (const fib of fibLevels) {
    if (fib.ratio === 0 || fib.ratio === 1.0) continue;
    let strength = 1;
    let nearestEma: number | null = null;

    for (const ema of emaValues) {
      if (Math.abs(ema.price - fib.price) <= tolerance) {
        strength++;
        nearestEma = ema.period;
      }
    }
    // Also check if another Fib level from the same set is nearby
    for (const other of fibLevels) {
      if (other === fib) continue;
      if (Math.abs(other.price - fib.price) <= tolerance) strength++;
    }

    if (strength >= 1) {
      zones.push({
        priceCenter: fib.price,
        priceLow:    fib.price - tolerance,
        priceHigh:   fib.price + tolerance,
        fibRatio:    fib.ratio,
        emaPeriod:   nearestEma,
        strength:    Math.min(5, strength),
        zoneType:    fib.zoneType,
      });
    }
  }

  return zones.sort((a, b) => b.strength - a.strength);
}

// ── VWAP ──────────────────────────────────────────────────────────────────────

export function calcVWAP(candles: OHLCV[]): number {
  let tpv = 0, vol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    tpv += tp * c.volume;
    vol += c.volume;
  }
  return vol > 0 ? tpv / vol : candles[candles.length - 1]?.close ?? 0;
}

// ── Candlestick Pattern Detection ─────────────────────────────────────────────

export function detectCandlestickPattern(candles: OHLCV[]): CandlePattern {
  if (candles.length < 3) return { name: 'None', signal: 'NEUTRAL', reliability: 0 };

  const [c1, c2, c3] = [candles[candles.length - 3], candles[candles.length - 2], candles[candles.length - 1]];
  const body3 = Math.abs(c3.close - c3.open);
  const range3 = c3.high - c3.low;
  const lowerWick3 = Math.min(c3.open, c3.close) - c3.low;
  const upperWick3 = c3.high - Math.max(c3.open, c3.close);

  // Hammer: small body at top, long lower wick (2x body), bullish
  if (lowerWick3 >= body3 * 2 && upperWick3 <= body3 * 0.5 && body3 > 0 && c3.close > c3.open) {
    return { name: 'Hammer', signal: 'BUY', reliability: 0.72 };
  }

  // Inverted Hammer: small body at bottom, long upper wick
  if (upperWick3 >= body3 * 2 && lowerWick3 <= body3 * 0.5 && body3 > 0 && c3.close > c3.open) {
    return { name: 'Inverted Hammer', signal: 'BUY', reliability: 0.58 };
  }

  // Bullish Engulfing: bearish c2, bullish c3, c3 body engulfs c2 body
  const body2 = Math.abs(c2.close - c2.open);
  if (c2.close < c2.open && c3.close > c3.open && c3.open <= c2.close && c3.close >= c2.open && body3 > body2) {
    return { name: 'Bullish Engulfing', signal: 'BUY', reliability: 0.79 };
  }

  // Bearish Engulfing: bullish c2, bearish c3
  if (c2.close > c2.open && c3.close < c3.open && c3.open >= c2.close && c3.close <= c2.open && body3 > body2) {
    return { name: 'Bearish Engulfing', signal: 'SELL', reliability: 0.79 };
  }

  // Doji: body <= 10% of range
  if (range3 > 0 && body3 / range3 <= 0.10) {
    return { name: 'Doji', signal: 'NEUTRAL', reliability: 0.50 };
  }

  // Morning Star (3 candle): bearish c1, small body c2, bullish c3
  const body1 = Math.abs(c1.close - c1.open);
  if (c1.close < c1.open && body2 <= body1 * 0.3 && c3.close > c3.open && c3.close > (c1.open + c1.close) / 2) {
    return { name: 'Morning Star', signal: 'BUY', reliability: 0.84 };
  }

  // Evening Star (3 candle): bullish c1, small body c2, bearish c3
  if (c1.close > c1.open && body2 <= body1 * 0.3 && c3.close < c3.open && c3.close < (c1.open + c1.close) / 2) {
    return { name: 'Evening Star', signal: 'SELL', reliability: 0.84 };
  }

  // Shooting Star: small body at bottom, long upper wick, bearish
  if (upperWick3 >= body3 * 2 && lowerWick3 <= body3 * 0.5 && c3.close < c3.open) {
    return { name: 'Shooting Star', signal: 'SELL', reliability: 0.70 };
  }

  return { name: 'No Pattern', signal: 'NEUTRAL', reliability: 0 };
}

// ── Divergence Detection ──────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(50);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rsi.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  }
  return rsi;
}

export function detectDivergence(candles: OHLCV[]): DivergenceResult {
  if (candles.length < 30) return { type: 'NONE', indicator: 'NONE', strength: 0 };

  const closes = candles.map(c => c.close);
  const rsiArr = calcRSI(closes);

  // Find last two price lows
  const lows: { idx: number; price: number; rsi: number }[] = [];
  for (let i = 3; i < candles.length - 2; i++) {
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low &&
        candles[i].low < candles[i + 1].low && candles[i].low < candles[i + 2].low) {
      lows.push({ idx: i, price: candles[i].low, rsi: rsiArr[i] ?? 50 });
    }
  }

  if (lows.length >= 2) {
    const prev = lows[lows.length - 2];
    const curr = lows[lows.length - 1];
    // Bullish divergence: price lower low but RSI higher low
    if (curr.price < prev.price && curr.rsi > prev.rsi + 2) {
      const strength = Math.min(1, (curr.rsi - prev.rsi) / 20);
      return { type: 'BULLISH', indicator: 'RSI', strength };
    }
  }

  // Find last two price highs
  const highs: { idx: number; price: number; rsi: number }[] = [];
  for (let i = 3; i < candles.length - 2; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high &&
        candles[i].high > candles[i + 1].high && candles[i].high > candles[i + 2].high) {
      highs.push({ idx: i, price: candles[i].high, rsi: rsiArr[i] ?? 50 });
    }
  }

  if (highs.length >= 2) {
    const prev = highs[highs.length - 2];
    const curr = highs[highs.length - 1];
    // Bearish divergence: price higher high but RSI lower high
    if (curr.price > prev.price && curr.rsi < prev.rsi - 2) {
      const strength = Math.min(1, (prev.rsi - curr.rsi) / 20);
      return { type: 'BEARISH', indicator: 'RSI', strength };
    }
  }

  return { type: 'NONE', indicator: 'NONE', strength: 0 };
}

// ── Main Agent Orchestrator ───────────────────────────────────────────────────

export function runFibonacciAgent(
  candles: OHLCV[],
  currentPrice: number,
  fibReliability?: FibReliabilityMap
): FibAgentVote {

  if (candles.length < 50) {
    return {
      persona: 'Fibonacci-EMA Agent',
      signal: 'HOLD',
      confidence: 0,
      reasoning: 'Insufficient candle history for Fibonacci analysis (need 50+)',
      fibLevels: [], emaStack: calcEMAStack(candles.map(c => c.close)),
      confluenceZones: [], nearestZone: null,
      candlePattern: { name: 'None', signal: 'NEUTRAL', reliability: 0 },
      divergence: { type: 'NONE', indicator: 'NONE', strength: 0 },
      vwap: currentPrice, isAboveVwap: false,
      entryZone: null, stopLoss: null, target1: null, target2: null, riskReward: null,
      alertTier: 'NONE',
      swingHigh: currentPrice, swingLow: currentPrice,
    };
  }

  const closes = candles.map(c => c.close);
  const emaStack = calcEMAStack(closes);
  const vwap = calcVWAP(candles);
  const isAboveVwap = currentPrice > vwap;

  // Detect swing points
  const swings = detectSwingPoints(candles);
  const recentHighs = swings.filter(s => s.type === 'high').slice(-2);
  const recentLows  = swings.filter(s => s.type === 'low').slice(-2);

  const swingHigh = recentHighs.length > 0 ? Math.max(...recentHighs.map(s => s.price)) : Math.max(...closes.slice(-50));
  const swingLow  = recentLows.length > 0  ? Math.min(...recentLows.map(s => s.price))  : Math.min(...closes.slice(-50));

  // Determine trend direction from EMA
  const uptrend = emaStack.trend === 'BULLISH' || emaStack.ema21 > emaStack.ema50;

  // Fibonacci levels
  const fibLevels = calcFibRetracement(swingHigh, swingLow, uptrend);

  // Extension levels (using deepest retracement)
  const retraceLow = uptrend ? swingLow : swingHigh;
  const extLevels  = calcFibExtension(swingLow, swingHigh, retraceLow);
  const allLevels  = [...fibLevels, ...extLevels];

  // Confluence zones
  const confluenceZones = findConfluenceZones(fibLevels, emaStack, currentPrice);

  // Find nearest zone
  const nearestZone = confluenceZones.reduce<ConfluenceZone | null>((nearest, zone) => {
    const dist = Math.abs(zone.priceCenter - currentPrice);
    if (!nearest) return zone;
    return dist < Math.abs(nearest.priceCenter - currentPrice) ? zone : nearest;
  }, null);

  // Candlestick pattern
  const candlePattern = detectCandlestickPattern(candles);

  // Divergence
  const divergence = detectDivergence(candles);

  // Proximity to zone
  const nearestFibLevel = fibLevels.reduce((nearest, level) => {
    return Math.abs(level.price - currentPrice) < Math.abs(nearest.price - currentPrice) ? level : nearest;
  }, fibLevels[0]);

  const distancePct = nearestFibLevel
    ? Math.abs(nearestFibLevel.price - currentPrice) / currentPrice
    : 1;

  // Alert tier
  let alertTier: FibAgentVote['alertTier'] = 'NONE';
  if (distancePct < 0.005 && candlePattern.signal !== 'NEUTRAL') alertTier = 'TRIGGERED';
  else if (distancePct < 0.005) alertTier = 'AT_ZONE';
  else if (distancePct < 0.02) alertTier = 'APPROACHING';

  // ── Signal logic ──────────────────────────────────────────────────────────

  let baseSignal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let baseConfidence = 0.40;

  const atSupport = nearestFibLevel && nearestFibLevel.zoneType === 'support' && distancePct < 0.01;
  const atResistance = nearestFibLevel && nearestFibLevel.zoneType === 'resistance' && distancePct < 0.01;

  if (atSupport && uptrend) {
    baseSignal = 'BUY';
    baseConfidence = 0.55;
  } else if (atResistance && !uptrend) {
    baseSignal = 'SELL';
    baseConfidence = 0.55;
  }

  // Confidence modifiers
  if (nearestZone && nearestZone.emaPeriod !== null) baseConfidence += 0.10; // EMA confluence
  if (nearestZone && nearestZone.strength >= 3) baseConfidence += 0.08;    // strong zone
  if (candlePattern.signal === baseSignal) baseConfidence += candlePattern.reliability * 0.15;
  if (candlePattern.signal === 'NEUTRAL' && candlePattern.name === 'Doji') baseConfidence -= 0.10;
  if (divergence.type === 'BULLISH' && baseSignal === 'BUY')  baseConfidence += divergence.strength * 0.10;
  if (divergence.type === 'BEARISH' && baseSignal === 'SELL') baseConfidence += divergence.strength * 0.10;
  if (isAboveVwap && baseSignal === 'BUY')  baseConfidence += 0.05;
  if (!isAboveVwap && baseSignal === 'SELL') baseConfidence += 0.05;

  // Apply per-stock reliability from Python backtester
  if (fibReliability && nearestFibLevel) {
    const key = nearestFibLevel.ratio.toFixed(3);
    const rel = fibReliability[key];
    if (rel && rel.sampleSize >= 5) {
      baseConfidence = baseConfidence * 0.7 + rel.bounceRate * 0.3;
    }
  }

  // EMA trend override — don't fight a strong trend
  if (emaStack.trend === 'BEARISH' && baseSignal === 'BUY' && emaStack.ema200 > currentPrice) {
    baseConfidence *= 0.7;
  }
  if (emaStack.trend === 'BULLISH' && baseSignal === 'SELL' && emaStack.ema200 < currentPrice) {
    baseConfidence *= 0.7;
  }

  const confidence = Math.min(0.95, Math.max(0, baseConfidence));
  if (confidence < 0.45) baseSignal = 'HOLD';

  // ── SL/TP Calculation ─────────────────────────────────────────────────────

  let entryZone: [number, number] | null = null;
  let stopLoss: number | null = null;
  let target1: number | null = null;
  let target2: number | null = null;
  let riskReward: number | null = null;

  if (baseSignal !== 'HOLD' && nearestFibLevel) {
    const tol = currentPrice * 0.005;
    entryZone = [nearestFibLevel.price - tol, nearestFibLevel.price + tol];

    if (baseSignal === 'BUY') {
      // SL: next Fib level below
      const nextLower = fibLevels.filter(l => l.price < nearestFibLevel.price).sort((a, b) => b.price - a.price)[0];
      stopLoss = nextLower ? nextLower.price : nearestFibLevel.price * (1 - 0.02);
      // Targets: extension levels
      const ext1 = extLevels.find(l => l.ratio === 1.272);
      const ext2 = extLevels.find(l => l.ratio === 1.618);
      target1 = ext1?.price ?? currentPrice * 1.03;
      target2 = ext2?.price ?? currentPrice * 1.05;
    } else {
      const nextHigher = fibLevels.filter(l => l.price > nearestFibLevel.price).sort((a, b) => a.price - b.price)[0];
      stopLoss = nextHigher ? nextHigher.price : nearestFibLevel.price * (1 + 0.02);
      target1 = currentPrice * 0.97;
      target2 = currentPrice * 0.94;
    }

    const risk   = Math.abs(currentPrice - (stopLoss ?? currentPrice));
    const reward = Math.abs((target1 ?? currentPrice) - currentPrice);
    riskReward = risk > 0 ? parseFloat((reward / risk).toFixed(2)) : null;
  }

  // ── Reasoning ─────────────────────────────────────────────────────────────

  const reasons: string[] = [];
  if (nearestFibLevel) reasons.push(`Price near ${nearestFibLevel.label} Fib (₹${nearestFibLevel.price.toFixed(2)})`);
  if (nearestZone?.emaPeriod) reasons.push(`${nearestZone.emaPeriod}-EMA confluence`);
  reasons.push(`EMA stack: ${emaStack.trend}`);
  if (candlePattern.name !== 'No Pattern' && candlePattern.name !== 'None') reasons.push(`${candlePattern.name} candle`);
  if (divergence.type !== 'NONE') reasons.push(`${divergence.type} RSI divergence`);
  reasons.push(isAboveVwap ? 'Above VWAP' : 'Below VWAP');
  if (riskReward) reasons.push(`R:R = ${riskReward}:1`);

  return {
    persona: 'Fibonacci-EMA Agent',
    signal: baseSignal,
    confidence,
    reasoning: reasons.join(' | '),
    fibLevels: allLevels,
    emaStack,
    confluenceZones,
    nearestZone,
    candlePattern,
    divergence,
    vwap,
    isAboveVwap,
    entryZone,
    stopLoss,
    target1,
    target2,
    riskReward,
    alertTier,
    swingHigh,
    swingLow,
  };
}
