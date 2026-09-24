/**
 * fibonacciRouter.ts
 * tRPC endpoints for Fibonacci-EMA analysis.
 * Fetches daily OHLCV from Yahoo Finance, runs the Fibonacci agent,
 * optionally enriches with Python reliability scores, and returns full analysis.
 */

import { router, publicProcedure } from './_core/trpc';
import { z } from 'zod';
import axios from 'axios';
import { runFibonacciAgent, type OHLCV, type FibReliabilityMap } from './_core/fibonacciAgent';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5000';

// ── Yahoo Finance OHLCV fetcher ───────────────────────────────────────────────

async function fetchDailyOHLCV(symbol: string, days = 200): Promise<OHLCV[]> {
  const yahooSymbol = symbol.includes('.') ? symbol : `${symbol}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  try {
    const resp = await axios.get(url, {
      params: { range: '1y', interval: '1d', events: 'div|split' },
      timeout: 15_000,
    });
    const result = resp.data?.chart?.result?.[0];
    if (!result?.timestamp) return [];

    const timestamps: number[] = result.timestamp;
    const q = result.indicators?.quote?.[0];
    if (!q) return [];

    return timestamps
      .map((ts, i) => ({
        timestamp: new Date(ts * 1000).toISOString(),
        open:   q.open?.[i]   ?? 0,
        high:   q.high?.[i]   ?? 0,
        low:    q.low?.[i]    ?? 0,
        close:  q.close?.[i]  ?? 0,
        volume: q.volume?.[i] ?? 0,
      }))
      .filter(c => c.close > 0 && c.volume > 0)
      .slice(-days);
  } catch {
    return [];
  }
}

// ── Fibonacci Reliability from Python service ─────────────────────────────────

async function fetchFibReliability(symbol: string, candles: OHLCV[]): Promise<FibReliabilityMap> {
  try {
    const resp = await axios.post(
      `${ML_SERVICE_URL}/fib-reliability`,
      { symbol, candles },
      { timeout: 10_000 }
    );
    return resp.data?.levels ?? {};
  } catch {
    // Python service unavailable — return empty, agent uses defaults
    return {};
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const fibonacciRouter = router({
  getFibAnalysis: publicProcedure
    .input(z.object({
      symbol:       z.string(),
      currentPrice: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const candles = await fetchDailyOHLCV(input.symbol);
      if (candles.length < 50) {
        return { error: 'Insufficient historical data', fibAnalysis: null };
      }

      const currentPrice = input.currentPrice ?? candles[candles.length - 1].close;

      // Fetch reliability map from Python (non-blocking — uses default if unavailable)
      const fibReliability = await fetchFibReliability(input.symbol, candles);

      const fibAnalysis = runFibonacciAgent(candles, currentPrice, fibReliability);

      return { error: null, fibAnalysis };
    }),

  // Lightweight endpoint — just returns Fib levels for chart overlay (no ML call)
  getFibLevels: publicProcedure
    .input(z.object({
      symbol:       z.string(),
      currentPrice: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const candles = await fetchDailyOHLCV(input.symbol, 120);
      if (candles.length < 50) return { fibLevels: [], emaStack: null, swingHigh: 0, swingLow: 0 };

      const currentPrice = input.currentPrice ?? candles[candles.length - 1].close;
      const analysis = runFibonacciAgent(candles, currentPrice);

      return {
        fibLevels:      analysis.fibLevels,
        emaStack:       analysis.emaStack,
        confluenceZones: analysis.confluenceZones,
        swingHigh:      analysis.swingHigh,
        swingLow:       analysis.swingLow,
        signal:         analysis.signal,
        alertTier:      analysis.alertTier,
        nearestZone:    analysis.nearestZone,
        vwap:           analysis.vwap,
      };
    }),
});
