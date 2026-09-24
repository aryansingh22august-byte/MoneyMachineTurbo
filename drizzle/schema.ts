import { pgTable, text, integer, serial, real, index } from "drizzle-orm/pg-core";

/**
 * Timestamp columns below are stored as ISO-8601 text and compared with plain
 * string operators (`gte`, `desc`), so every writer must emit the exact format
 * `Date.prototype.toISOString()` produces — `YYYY-MM-DDTHH:mm:ss.sssZ`.
 *
 * They are deliberately `notNull()` with NO database default. A default would
 * have to be `to_char(now() ...)`, whose output must match toISOString() byte
 * for byte or ordering silently breaks (Postgres' native `now()::text` renders
 * a space separator, which sorts before 'T'). Omitting the default instead
 * makes the column REQUIRED in Drizzle's inferred insert type, so a forgotten
 * timestamp is a compile error rather than a row that quietly disappears from
 * every history query.
 */

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: serial("id").primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role").default("user").notNull(),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
  lastSignedIn: text("lastSignedIn").notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Stock master data
export const stocks = pgTable("stocks", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  companyName: text("companyName").notNull(),
  exchange: text("exchange").notNull(),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: real("marketCap"),
  peRatio: real("peRatio"),
  dividendYield: real("dividendYield"),
  bookValue: real("bookValue"),
  eps: real("eps"),
  lastUpdated: text("lastUpdated"),
  createdAt: text("createdAt"),
});

export type Stock = typeof stocks.$inferSelect;
export type InsertStock = typeof stocks.$inferInsert;

// Real-time stock prices
export const stockPrices = pgTable("stockPrices", {
  id: serial("id").primaryKey(),
  stockId: integer("stockId").notNull(),
  lastPrice: real("lastPrice").notNull(),
  change: real("change"),
  percentChange: real("percentChange"),
  open: real("open"),
  high: real("high"),
  low: real("low"),
  previousClose: real("previousClose"),
  volume: integer("volume"),
  /** ISO-8601 UTC. NOT NULL — history/ordering queries filter on this column. */
  timestamp: text("timestamp").notNull(),
}, (t) => [
  // Backs the DISTINCT ON (stockId) ... ORDER BY stockId, timestamp DESC, id DESC
  // "latest price per stock" query and the per-stock history range scans.
  index("stockPrices_stockId_timestamp_id_idx")
    .on(t.stockId, t.timestamp.desc().nullsFirst(), t.id.desc().nullsFirst()),
]);

export type StockPrice = typeof stockPrices.$inferSelect;
export type InsertStockPrice = typeof stockPrices.$inferInsert;

// ML Predictions with buy/sell signals
export const predictions = pgTable("predictions", {
  id: serial("id").primaryKey(),
  stockId: integer("stockId").notNull(),
  signal: text("signal").notNull(),
  strength: integer("strength").notNull(), // 0-100 confidence score
  technicalScore: integer("technicalScore"), // Technical indicator score
  sentimentScore: integer("sentimentScore"), // News sentiment score
  rsi: real("rsi"),
  macd: real("macd"),
  sma20: real("sma20"),
  sma50: real("sma50"),
  predictedPrice: real("predictedPrice"),
  /** ISO-8601 UTC. NOT NULL — history/ordering queries filter on this column. */
  timestamp: text("timestamp").notNull(),
}, (t) => [
  index("predictions_stockId_timestamp_id_idx")
    .on(t.stockId, t.timestamp.desc().nullsFirst(), t.id.desc().nullsFirst()),
]);

export type Prediction = typeof predictions.$inferSelect;
export type InsertPrediction = typeof predictions.$inferInsert;

// User watchlist
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  stockId: integer("stockId").notNull(),
  addedAt: text("addedAt"),
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = typeof watchlist.$inferInsert;

// News sentiment analysis
export const newsSentiment = pgTable("newsSentiment", {
  id: serial("id").primaryKey(),
  stockId: integer("stockId").notNull(),
  headline: text("headline").notNull(),
  source: text("source"),
  sentimentScore: integer("sentimentScore").notNull(), // 0-100 score
  sentimentLabel: text("sentimentLabel").notNull(),
  url: text("url"),
  /** ISO-8601 UTC article publish time. NOT NULL — sentiment lookback filters on this. */
  publishedAt: text("publishedAt").notNull(),
  /** ISO-8601 UTC row insert time. */
  createdAt: text("createdAt").notNull(),
}, (t) => [
  // Backs getRecentNewsSentiment's (stockId, publishedAt >= since) lookback.
  index("newsSentiment_stockId_publishedAt_idx").on(t.stockId, t.publishedAt.desc().nullsFirst()),
]);

export type NewsSentiment = typeof newsSentiment.$inferSelect;
export type InsertNewsSentiment = typeof newsSentiment.$inferInsert;

// User alerts/notifications
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  stockId: integer("stockId").notNull(),
  alertType: text("alertType").notNull(),
  condition: text("condition"), // e.g., "ABOVE", "BELOW", "STRONG_BUY"
  value: real("value"), // price target or score threshold
  message: text("message"),
  isActive: integer("isActive").default(1).notNull(),
  triggeredAt: text("triggeredAt"),
  createdAt: text("createdAt"),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// Prediction accuracy tracking
export const accuracyTracking = pgTable("accuracyTracking", {
  id: serial("id").primaryKey(),
  stockId: integer("stockId").notNull(),
  predictionId: integer("predictionId").notNull(),
  actualSignal: text("actualSignal"),
  isCorrect: integer("isCorrect"), // 1 for correct, 0 for incorrect
  priceAtPrediction: real("priceAtPrediction"),
  priceAtResolution: real("priceAtResolution"),
  returnPercentage: real("returnPercentage"),
  resolutionDate: text("resolutionDate"),
  createdAt: text("createdAt"),
});

export type AccuracyTracking = typeof accuracyTracking.$inferSelect;
export type InsertAccuracyTracking = typeof accuracyTracking.$inferInsert;

// Virtual paper trading - user wallets
export const paperWallets = pgTable("paperWallets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  balance: real("balance").default(1000).notNull(), // Starts with 1000 INR
  totalGained: real("totalGained").default(0).notNull(),
  totalLost: real("totalLost").default(0).notNull(),
  createdAt: text("createdAt"),
  updatedAt: text("updatedAt"),
});

export type PaperWallet = typeof paperWallets.$inferSelect;
export type InsertPaperWallet = typeof paperWallets.$inferInsert;

// Virtual paper trading - trade logs
export const paperTrades = pgTable("paperTrades", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  stockId: integer("stockId").notNull(),
  symbol: text("symbol").notNull(), // Store symbol explicitly to avoid constant joins
  type: text("type").notNull(), // BUY or SELL
  status: text("status").notNull(), // OPEN or CLOSED
  mode: text("mode").notNull(), // FIXED (2%) or AI
  entryPrice: real("entryPrice").notNull(), // Includes slippage
  quantity: integer("quantity").notNull(),
  stopLoss: real("stopLoss").notNull(),
  targetPrice: real("targetPrice").notNull(),
  exitPrice: real("exitPrice"), // Includes slippage
  realPnl: real("realPnl"), // Final gained/lost amt
  openedAt: text("openedAt").notNull(),
  closedAt: text("closedAt"),
  reasoning: text("reasoning"), // Why the bot took this trade
});

export type PaperTrade = typeof paperTrades.$inferSelect;
export type InsertPaperTrade = typeof paperTrades.$inferInsert;

// Bot persistent state
export const botState = pgTable("botState", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(), // One state per user
  isActive: integer("isActive").default(0).notNull(), // 0 for false, 1 for true
  globalScreenerMode: integer("globalScreenerMode").default(0).notNull(),
  allocPerTrade: real("allocPerTrade").default(10000).notNull(),
  stopLossPct: real("stopLossPct").default(2.0).notNull(),
  targetPct: real("targetPct").default(4.0).notNull(),
  scalpMode: integer("scalpMode").default(0).notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export type BotState = typeof botState.$inferSelect;
export type InsertBotState = typeof botState.$inferInsert;