import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { stockRouter } from "./stockRouter";
import { swarmRouter } from "./swarmRouter";
import { tradingRouter } from "./tradingRouter";
import { fibonacciRouter } from "./fibonacciRouter";
import {
  getNewsSentimentHistory,
  getPredictionHistory,
  getRecentAlertsForUser,
  getUserWatchlistWithDetails,
} from "./db";
import { mlServiceClient } from "./_core/mlServiceClient";
import { getGlobalMacroGravity } from "./_core/macroEconomics";
import axios from "axios";

// ── Sentiment sub-router ───────────────────────────────────────────────────
const sentimentRouter = router({
  getHistory: publicProcedure
    .input(z.object({ stockId: z.number(), days: z.number().default(30) }))
    .query(async ({ input }) => {
      return await getNewsSentimentHistory(input.stockId, input.days);
    }),
});

// ── Prediction sub-router ──────────────────────────────────────────────────
const predictionRouter = router({
  getHistory: publicProcedure
    .input(z.object({ stockId: z.number(), limit: z.number().default(30) }))
    .query(async ({ input }) => {
      return await getPredictionHistory(input.stockId, input.limit);
    }),
});

// ── Alert sub-router ───────────────────────────────────────────────────────
const alertRouter = router({
  getRecent: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ ctx, input }) => {
      return await getRecentAlertsForUser(ctx.user.id, input.limit);
    }),
});

// ── ML sub-router ──────────────────────────────────────────────────────────
const mlRouter = router({
  getModelStats: publicProcedure.query(async () => {
    try {
      const result = await mlServiceClient.listModels();
      const models = Array.isArray(result.models) ? result.models : [];
      const count = typeof result.count === 'number' ? result.count : models.length;

      // Guard NaN/Infinity — only count finite numeric accuracy values
      const validAccuracies = models
        .map((m: any) => m?.accuracy)
        .filter((a: any): a is number => typeof a === 'number' && isFinite(a));
      const averageAccuracy = validAccuracies.length > 0
        ? validAccuracies.reduce((s: number, a: number) => s + a, 0) / validAccuracies.length
        : 0;

      // Distinguish "service up with no models" from "service healthy with models"
      const mlServiceHealthy = true;
      const hasModels = count > 0;

      return {
        totalModels: count,
        averageAccuracy,
        predictionsToday: 0,
        mlServiceHealthy,
        hasModels,
        lastRetrainTime: null as string | null,
        topFeatures: [] as Array<{ name: string; importance: number }>,
      };
    } catch (error) {
      console.error('[ML Service] Error fetching model stats:', error);
      return {
        totalModels: 0,
        averageAccuracy: 0,
        predictionsToday: 0,
        mlServiceHealthy: false,
        hasModels: false,
        lastRetrainTime: null as string | null,
        topFeatures: [] as Array<{ name: string; importance: number }>,
      };
    }
  }),
});

// ── Watchlist sub-router ───────────────────────────────────────────────────
const watchlistRouter = router({
  getMyWatchlist: protectedProcedure.query(async ({ ctx }) => {
    return await getUserWatchlistWithDetails(ctx.user.id);
  }),
});

// ── Upstox status sub-router ───────────────────────────────────────────────
const upstoxRouter = router({
  /** Returns token validity, countdown in seconds, and the OAuth login URL */
  getStatus: publicProcedure.query(async ({ ctx }) => {
    try {
      // Call the Express handler directly via localhost to avoid circular import
      const port = process.env.PORT || "3000";
      const url = `http://localhost:${port}/api/upstox/status`;
      const { data } = await axios.get(url, { timeout: 3000 });
      return data as {
        hasToken: boolean;
        isValid: boolean;
        expiresAt: string | null;
        expiresInSeconds: number | null;
        loginUrl: string;
      };
    } catch {
      return {
        hasToken: false,
        isValid: false,
        expiresAt: null,
        expiresInSeconds: null,
        loginUrl: "/api/upstox/login",
      };
    }
  }),
});

// ── Root app router ────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    // Requires authentication — prevents CSRF from clearing other users' sessions
    logout: protectedProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  stock: stockRouter,
  swarm: swarmRouter,
  sentiment: sentimentRouter,
  prediction: predictionRouter,
  alert: alertRouter,
  ml: mlRouter,
  watchlist: watchlistRouter,
  upstox: upstoxRouter,
  fibonacci: fibonacciRouter,
  trading: tradingRouter,
  macro: router({
    getGravity: publicProcedure.query(async () => {
      return await getGlobalMacroGravity();
    }),
  }),
});

export type AppRouter = typeof appRouter;

