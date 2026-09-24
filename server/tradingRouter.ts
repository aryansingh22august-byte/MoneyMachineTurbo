import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  getPaperWallet,
  getActivePaperTrades,
  getPaperTradeHistory,
  insertPaperTrade,
  updatePaperTrade,
  executePaperTradeDeduction,
  updatePaperWalletData,
} from "./db";

export const tradingRouter = router({
  // ── Read ────────────────────────────────────────────────────────────────
  getWallet: publicProcedure.query(async () => {
    return await getPaperWallet(1);
  }),
  getActiveTrades: publicProcedure.query(async () => {
    return await getActivePaperTrades(1);
  }),
  
  // ── Bot Control ──────────────────────────────────────────────────────────
  getBotStatus: publicProcedure.query(async () => {
    const { paperBotService } = await import('./_core/paperBotService');
    return paperBotService.getStatus();
  }),
  toggleBot: publicProcedure
    .input(z.object({ state: z.boolean() }))
    .mutation(async ({ input }) => {
      const { paperBotService } = await import('./_core/paperBotService');
      await paperBotService.toggle(input.state);
      return paperBotService.getStatus();
    }),
  updateBotConfig: publicProcedure
    .input(z.object({
      allocPerTrade: z.number().min(1000),
      stopLossPct: z.number().min(0.5).max(10),
      targetPct: z.number().min(1).max(20),
      scalpMode: z.boolean().optional()
    }))
    .mutation(async ({ input }) => {
      const { paperBotService } = await import('./_core/paperBotService');
      await paperBotService.updateConfig(input);
      return paperBotService.getStatus();
    }),

  toggleGlobalScreener: publicProcedure
    .input(z.object({ state: z.boolean() }))
    .mutation(async ({ input }) => {
      const { paperBotService } = await import('./_core/paperBotService');
      await paperBotService.toggleGlobalScreener(input.state);
      return paperBotService.getStatus();
    }),

  squareOffAll: publicProcedure.mutation(async () => {
    const { paperBotService } = await import('./_core/paperBotService');
    return await paperBotService.squareOffAll();
  }),

  getOptionChain: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      const { optionsService } = await import('./_core/optionsService');
      return await optionsService.fetchOptionWalls(input.symbol);
    }),

  getTradeHistory: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return await getPaperTradeHistory(1, input.limit);
    }),

  // ── Place Trade ─────────────────────────────────────────────────────────
  placeTrade: publicProcedure
    .input(z.object({
      stockId: z.number(),
      symbol: z.string(),
      type: z.enum(['BUY', 'SELL']),
      entryPrice: z.number(),
      quantity: z.number().min(1),
      stopLoss: z.number(),
      targetPrice: z.number(),
      reasoning: z.string().optional(),
      mode: z.enum(['AI', 'MANUAL']).default('MANUAL'),
    }))
    .mutation(async ({ input }) => {
      const userId = 1;
      const totalCost = input.entryPrice * input.quantity;

      // Deduct from wallet
      const canAfford = await executePaperTradeDeduction(userId, totalCost);
      if (!canAfford) {
        throw new Error('Insufficient balance for this trade.');
      }

      const trade = await insertPaperTrade({
        userId,
        stockId: input.stockId,
        symbol: input.symbol,
        type: input.type,
        status: 'OPEN',
        mode: input.mode,
        entryPrice: input.entryPrice,
        quantity: input.quantity,
        stopLoss: input.stopLoss,
        targetPrice: input.targetPrice,
        reasoning: input.reasoning ?? 'Manual trade',
        openedAt: new Date().toISOString(),
      });

      return trade;
    }),

  // ── Close Trade (manual exit) ────────────────────────────────────────────
  closeTrade: publicProcedure
    .input(z.object({
      tradeId: z.number(),
      exitPrice: z.number(),
    }))
    .mutation(async ({ input }) => {
      const userId = 1;
      const openTrades = await getActivePaperTrades(userId);
      const trade = openTrades.find(t => t.id === input.tradeId);
      if (!trade) throw new Error('Trade not found or already closed.');

      const grossReturn = input.exitPrice * trade.quantity;
      const realPnl = (input.exitPrice - trade.entryPrice) * trade.quantity;
      const isGain = realPnl >= 0;

      // Credit wallet back (capital + P&L)
      await updatePaperWalletData(userId, realPnl, isGain);
      // Return capital to wallet balance (the deduction above was for capital)
      const { getDb } = await import('./db');
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const { paperWallets } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (db) {
        const wallet = await getPaperWallet(userId);
        if (wallet) {
          await db.update(paperWallets)
            .set({ balance: wallet.balance + (trade.entryPrice * trade.quantity), updatedAt: new Date().toISOString() })
            .where(eq(paperWallets.userId, userId));
        }
      }

      await updatePaperTrade(trade.id, input.exitPrice, Math.round(realPnl * 100) / 100, new Date().toISOString());
      return { success: true, pnl: realPnl };
    }),

  // ── Reset Wallet ─────────────────────────────────────────────────────────
  resetWallet: publicProcedure
    .input(z.object({ amount: z.number().default(100000) }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { paperWallets, paperTrades } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('DB not available');

      await db.update(paperWallets).set({
        balance: input.amount,
        totalGained: 0,
        totalLost: 0,
        updatedAt: new Date().toISOString(),
      }).where(eq(paperWallets.userId, 1));

      // Close all open trades
      await db.update(paperTrades).set({ status: 'CLOSED', closedAt: new Date().toISOString(), realPnl: 0 })
        .where(eq(paperTrades.userId, 1));

      return { success: true };
    }),
});

