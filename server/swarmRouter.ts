import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { getSwarmIntelligenceReport, resetSwarmCache } from "./_core/miroFishBridge";
import { getGlobalAccuracyMetrics } from "./db";
import axios from "axios";

// Symbol → Yahoo Finance ticker mapping
const YAHOO_TICKER: Record<string, string> = {
  RELIANCE: "RELIANCE.NS", TCS: "TCS.NS", HDFCBANK: "HDFCBANK.NS",
  INFY: "INFY.NS", ICICIBANK: "ICICIBANK.NS", BPCL: "BPCL.NS",
  SBI: "SBIN.NS", TATAMOTORS: "TATAMOTORS.NS", CRUDEOIL: "CL=F",
  "MCX GOLD": "GC=F", JINDALSTEL: "JINDALSTEL.NS", HAL: "HAL.NS",
  BEL: "BEL.NS", JSWSTEEL: "JSWSTEEL.NS", TATASTEEL: "TATASTEEL.NS",
};

async function fetchYahooHistory(symbol: string, range = "5d", interval = "15m") {
  const ticker = YAHOO_TICKER[symbol] ?? (symbol.includes(".") ? symbol : `${symbol}.NS`);
  try {
    const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`, {
      params: { range, interval, events: "div|split" },
      timeout: 10_000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    return timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: '2-digit', minute: '2-digit' }),
      unix: ts * 1000,
      close: parseFloat((quote.close?.[i] ?? 0).toFixed(2)),
      open: parseFloat((quote.open?.[i] ?? 0).toFixed(2)),
      high: parseFloat((quote.high?.[i] ?? 0).toFixed(2)),
      low: parseFloat((quote.low?.[i] ?? 0).toFixed(2)),
      volume: quote.volume?.[i] ?? 0,
    })).filter(r => r.close > 0);
  } catch {
    return [];
  }
}

export const swarmRouter = router({
  getLatestPredictions: publicProcedure.query(async () => {
    return await getSwarmIntelligenceReport();
  }),

  triggerSimulation: publicProcedure.mutation(async () => {
    resetSwarmCache();
    const report = await getSwarmIntelligenceReport();
    return { success: true, predictionsCount: report.predictions.length };
  }),

  getStockHistory: publicProcedure
    .input(z.object({ symbol: z.string(), direction: z.enum(["UP", "DOWN", "NEUTRAL"]), percentChange: z.number(), impliedVolatility: z.number().optional().default(1) }))
    .query(async ({ input }) => {
      const history = await fetchYahooHistory(input.symbol);
      if (history.length === 0) return { history: [], predicted: [] };

      const lastClose = history[history.length - 1]?.close ?? 0;
      const multiplier = input.direction === "UP" ? 1 : input.direction === "DOWN" ? -1 : 0;
      // We are tracking 5 days ahead, so 20 * 15m intervals per day = 100 points
      const points = 40; 
      const stepValue = (lastClose * (input.percentChange / 100) * multiplier) / points;

      const lastUnix = history[history.length - 1]?.unix ?? Date.now();
      
      const predicted = Array.from({ length: points }, (_, i) => {
        const val = lastClose + stepValue * (i + 1);
        // Expand standard deviation over time
        const bounds = val * (input.impliedVolatility / 100) * ((i + 1) / points);
        const currentUnix = lastUnix + (i + 1) * 900000; // 15 min steps
        return {
          date: new Date(currentUnix).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: '2-digit', minute: '2-digit' }),
          predicted: parseFloat(val.toFixed(2)),
          predictedUpper: parseFloat((val + bounds).toFixed(2)),
          predictedLower: parseFloat((val - bounds).toFixed(2)),
          close: null,
        };
      });

      return { history, predicted };
    }),

  // Feature 3: Global Accuracy Auditor
  getGlobalSwarmAccuracy: publicProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      return await getGlobalAccuracyMetrics(input?.limit ?? 100);
    }),

  // ── OHLCV feed for TradingView Chart ─────────────────────────────────────
  // Returns real Yahoo Finance OHLC bars directly to the frontend chart.
  // range: "1d" | "5d" | "1mo" | "3mo"
  // interval: "1m" | "5m" | "15m" | "30m" | "1h" | "1d"
  getOHLCHistory: publicProcedure
    .input(z.object({
      symbol: z.string(),
      range: z.enum(["1d", "5d", "1mo", "3mo"]).default("1mo"),
      interval: z.enum(["1m", "5m", "15m", "30m", "1h", "1d"]).default("1d"),
    }))
    .query(async ({ input }) => {
      const bars = await fetchYahooHistory(input.symbol, input.range, input.interval);
      return bars;
    }),
});
