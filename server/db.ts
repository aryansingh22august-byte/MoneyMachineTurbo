import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users, stocks, InsertStock, stockPrices, InsertStockPrice, predictions, InsertPrediction, watchlist, alerts, InsertAlert, newsSentiment, InsertNewsSentiment, accuracyTracking, paperWallets, paperTrades, InsertPaperWallet, InsertPaperTrade, botState, InsertBotState } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlSession: ReturnType<typeof postgres> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _sqlSession = postgres(process.env.DATABASE_URL);
      _db = drizzle(_sqlSession);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const now = new Date().toISOString();
    const values: InsertUser = {
      openId: user.openId,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date().toISOString();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date().toISOString();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Stock queries
export async function getStockBySymbol(symbol: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(stocks).where(eq(stocks.symbol, symbol)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllStocks() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(stocks);
}

export async function upsertStock(stock: InsertStock) {
  const db = await getDb();
  if (!db) return;
  await db.insert(stocks).values(stock).onConflictDoUpdate({
    target: stocks.symbol,
    set: {
      companyName: stock.companyName,
      sector: stock.sector,
      industry: stock.industry,
      marketCap: stock.marketCap,
      peRatio: stock.peRatio,
      dividendYield: stock.dividendYield,
      bookValue: stock.bookValue,
      eps: stock.eps,
      lastUpdated: new Date().toISOString(),
    },
  });
}

// Stock price queries
export async function getLatestStockPrice(stockId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(stockPrices)
    .where(eq(stockPrices.stockId, stockId))
    // id is the tiebreaker: the sync interval (5m) is shorter than the candle
    // interval (15m), so several rows can share one candle timestamp.
    .orderBy(desc(stockPrices.timestamp), desc(stockPrices.id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function insertStockPrice(price: InsertStockPrice) {
  const db = await getDb();
  if (!db) return;
  await db.insert(stockPrices).values(price);
}

// Prediction queries
export async function getLatestPrediction(stockId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(predictions)
    .where(eq(predictions.stockId, stockId))
    .orderBy(desc(predictions.timestamp), desc(predictions.id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function insertPrediction(prediction: InsertPrediction) {
  const db = await getDb();
  if (!db) return;
  await db.insert(predictions).values(prediction);
}

// Watchlist queries
export async function getUserWatchlist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(watchlist).where(eq(watchlist.userId, userId));
}

export async function getWatchersForStock(stockId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(watchlist).where(eq(watchlist.stockId, stockId));
}

export async function addToWatchlist(userId: number, stockId: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(watchlist).values({ userId, stockId });
}

export async function removeFromWatchlist(userId: number, stockId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.stockId, stockId)));
}

// Alert queries
export async function getUserAlerts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy((t) => desc(t.createdAt));
}

export async function createAlert(alert: InsertAlert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(alerts).values(alert);
}

export async function markAlertAsTriggered(alertId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ triggeredAt: new Date().toISOString() }).where(eq(alerts.id, alertId));
}

export async function getActiveAlertsForStock(stockId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(alerts).where(and(eq(alerts.stockId, stockId), eq(alerts.isActive, 1)));
}

// News sentiment queries
export async function getLatestNewsSentiment(stockId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(newsSentiment)
    .where(eq(newsSentiment.stockId, stockId))
    .orderBy((t) => desc(t.publishedAt))
    .limit(limit);
}

export async function getRecentNewsSentiment(stockId: number, hours: number = 24) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return await db
    .select()
    .from(newsSentiment)
    .where(and(eq(newsSentiment.stockId, stockId), gte(newsSentiment.publishedAt, since.toISOString())))
    .orderBy((t) => desc(t.publishedAt));
}

export async function insertNewsSentiment(sentiment: InsertNewsSentiment) {
  const db = await getDb();
  if (!db) return;
  await db.insert(newsSentiment).values(sentiment);
}

export async function getAverageSentimentScore(stockId: number, hours: number = 24): Promise<number | null> {
  const db = await getDb();
  if (!db) return null; // No DB — unknown, not neutral

  const recentSentiment = await getRecentNewsSentiment(stockId, hours);
  if (recentSentiment.length === 0) return null; // No data — unknown, not neutral

  // Filter out null sentimentScore records to avoid biasing the average
  const validScores = recentSentiment
    .map((item) => item.sentimentScore)
    .filter((s): s is number => s != null);

  if (validScores.length === 0) return null;
  return Math.round(validScores.reduce((sum, s) => sum + s, 0) / validScores.length);
}

/**
 * Average sentiment for many stocks in a single query.
 *
 * The per-stock helper above is fine for one lookup, but list endpoints were
 * calling it inside `Promise.all(...)` over every row, issuing one query per
 * stock. Returns a Map; a stock with no usable rows is absent from it, matching
 * the single-stock helper's `null` ("unknown", not "neutral").
 */
export async function getAverageSentimentScores(
  stockIds: number[],
  hours: number = 24,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const db = await getDb();
  if (!db || stockIds.length === 0) return result;

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select({
      stockId: newsSentiment.stockId,
      sentimentScore: newsSentiment.sentimentScore,
    })
    .from(newsSentiment)
    .where(and(inArray(newsSentiment.stockId, stockIds), gte(newsSentiment.publishedAt, since)));

  const totals = new Map<number, { sum: number; count: number }>();
  for (const row of rows) {
    if (row.sentimentScore == null) continue;
    const acc = totals.get(row.stockId) ?? { sum: 0, count: 0 };
    acc.sum += row.sentimentScore;
    acc.count += 1;
    totals.set(row.stockId, acc);
  }
  for (const [stockId, { sum, count }] of totals) {
    result.set(stockId, Math.round(sum / count));
  }
  return result;
}

// ── New query helpers ──────────────────────────────────────────────────────

/**
 * Recent stock price rows for a stock, **oldest first**.
 *
 * Chronological order is part of the contract: the SMC engine walks the array
 * forward (candles[i-2] must be older than candles[i]) and the price charts
 * plot left-to-right. The query itself sorts DESC so that `limit` keeps the
 * *newest* rows, then the page is reversed before returning.
 *
 * @param days    lookback window in days
 * @param maxRows hard cap on rows returned (defaults to ~4 readings/hour,
 *                bounded so a large `days` value can't pull tens of thousands
 *                of rows into memory)
 */
export async function getStockPriceHistory(
  stockId: number,
  days: number = 7,
  maxRows: number = 1000,
) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(maxRows, days * 96));
  const newestFirst = await db
    .select()
    .from(stockPrices)
    .where(and(eq(stockPrices.stockId, stockId), gte(stockPrices.timestamp, since)))
    .orderBy(desc(stockPrices.timestamp), desc(stockPrices.id))
    .limit(limit);
  return newestFirst.reverse();
}

/** All stocks joined with their most recent price row. */
export async function getAllStocksWithLatestPrices() {
  const db = await getDb();
  if (!db) return [];

  const [allStocks, latestPrices] = await Promise.all([
    db.select().from(stocks),
    // One row per stock, newest first — collapsed by the database rather than
    // by scanning the full price history in JS.
    db
      .selectDistinctOn([stockPrices.stockId])
      .from(stockPrices)
      .orderBy(stockPrices.stockId, desc(stockPrices.timestamp), desc(stockPrices.id)),
  ]);

  const latestPriceByStock = new Map(latestPrices.map((p) => [p.stockId, p]));

  return allStocks.map((stock) => {
    const price = latestPriceByStock.get(stock.id);
    return {
      ...stock,
      lastPrice: price?.lastPrice ?? null,
      change: price?.change ?? null,
      percentChange: price?.percentChange ?? null,
      volume: price?.volume ?? null,
    };
  });
}

/** Latest prediction for every tracked stock. */
export async function getAllLatestPredictions() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .selectDistinctOn([predictions.stockId])
    .from(predictions)
    .orderBy(predictions.stockId, desc(predictions.timestamp), desc(predictions.id));
}

/** Record a resolved prediction outcome for accuracy tracking. */
export async function insertAccuracyRecord(record: {
  stockId: number;
  predictionId: number;
  actualSignal?: string;
  isCorrect: 0 | 1;
  priceAtPrediction?: number;
  priceAtResolution?: number;
  returnPercentage?: number;
  resolutionDate?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(accuracyTracking).values({
    stockId: record.stockId,
    predictionId: record.predictionId,
    actualSignal: record.actualSignal ?? null,
    isCorrect: record.isCorrect,
    priceAtPrediction: record.priceAtPrediction ?? null,
    priceAtResolution: record.priceAtResolution ?? null,
    returnPercentage: record.returnPercentage ?? null,
    resolutionDate: record.resolutionDate ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}

/** Prediction accuracy metrics for one stock. */
export async function getAccuracyMetricsForStock(stockId: number) {
  const db = await getDb();
  if (!db) return { accuracy: 0, totalPredictions: 0, correct: 0, avgReturn: 0 };
  const records = await db
    .select()
    .from(accuracyTracking)
    .where(eq(accuracyTracking.stockId, stockId))
    .orderBy(desc(accuracyTracking.createdAt!))
    .limit(100);
  if (records.length === 0) return { accuracy: 0, totalPredictions: 0, correct: 0, avgReturn: 0 };
  const correct = records.filter((r) => r.isCorrect === 1).length;
  const avgReturn =
    records.reduce((sum, r) => sum + (r.returnPercentage ?? 0), 0) / records.length;
  return { accuracy: correct / records.length, totalPredictions: records.length, correct, avgReturn };
}

/** Stocks sorted by most recent percentChange descending. */
export async function getTopGainerStocks(limit: number = 20) {
  const enriched = await getAllStocksWithLatestPrices();
  const filtered = enriched
    .filter((s) => s.lastPrice !== null)
    .sort((a, b) => (b.percentChange ?? 0) - (a.percentChange ?? 0))
    .slice(0, limit);
  
  // One sentiment query for the whole page instead of one per row.
  const sentiments = await getAverageSentimentScores(filtered.map((s) => s.id));
  return filtered.map((s) => ({
    id: s.id,
    symbol: s.symbol,
    companyName: s.companyName,
    currentPrice: s.lastPrice ?? 0,
    percentChange: s.percentChange ?? 0,
    sentimentScore: sentiments.get(s.id) ?? null,
  }));
}

/** Daily-averaged sentiment history for a stock (for trend charts). */
export async function getNewsSentimentHistory(stockId: number, days: number = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const records = await db
    .select()
    .from(newsSentiment)
    .where(and(eq(newsSentiment.stockId, stockId), gte(newsSentiment.publishedAt!, since)))
    .orderBy(desc(newsSentiment.publishedAt!));

  const byDay = new Map<string, number[]>();
  for (const r of records) {
    const day = (r.publishedAt ?? r.createdAt ?? '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r.sentimentScore);
  }
  return Array.from(byDay.entries())
    .map(([date, scores]) => ({
      date,
      sentimentScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Prediction history joined with accuracy data for a stock. */
export async function getPredictionHistory(stockId: number, limit: number = 30) {
  const db = await getDb();
  if (!db) return [];
  const preds = await db
    .select()
    .from(predictions)
    .where(eq(predictions.stockId, stockId))
    .orderBy(desc(predictions.timestamp!))
    .limit(limit);
  const predictionIds = preds.map(p => p.id);
  const accuracy = predictionIds.length > 0 
    ? await db
        .select()
        .from(accuracyTracking)
        .where(inArray(accuracyTracking.predictionId, predictionIds))
    : [];
  return preds.map((p) => {
    const acc = accuracy.find((a) => a.predictionId === p.id);
    return { ...p, isCorrect: acc?.isCorrect ?? null, returnPercentage: acc?.returnPercentage ?? null };
  });
}

/** Get global Swarm accuracy percentage based on tracked accuracy outcomes. */
export async function getGlobalAccuracyMetrics(limit: number = 100) {
  const db = await getDb();
  if (!db) return { correct: 0, total: 0, accuracy: 0 };
  
  const records = await db
    .select()
    .from(accuracyTracking)
    .where(inArray(accuracyTracking.isCorrect, [0, 1]))
    .orderBy(desc(accuracyTracking.createdAt!))
    .limit(limit);

  const total = records.length;
  if (total === 0) return { correct: 0, total: 0, accuracy: 0 };

  const correct = records.filter(r => r.isCorrect === 1).length;
  return {
    correct,
    total,
    accuracy: Math.round((correct / total) * 100)
  };
}

/** Recent alerts enriched with stock symbol for a user. */
export async function getRecentAlertsForUser(userId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  const userAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.createdAt!))
    .limit(limit);
  return Promise.all(
    userAlerts.map(async (alert) => {
      const stock = await db!.select().from(stocks).where(eq(stocks.id, alert.stockId)).limit(1);
      return { ...alert, stockSymbol: stock[0]?.symbol ?? 'UNKNOWN', triggered: !!alert.triggeredAt };
    })
  );
}

/** User's watchlist enriched with live stock price data. */
export async function getUserWatchlistWithDetails(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const items = await db.select().from(watchlist).where(eq(watchlist.userId, userId));
  const stockIds = items.map((i) => i.stockId);
  if (stockIds.length === 0) return [];

  // Three bulk queries instead of three per watchlist row.
  const [stockRows, priceRows, sentiments] = await Promise.all([
    db.select().from(stocks).where(inArray(stocks.id, stockIds)),
    db
      .selectDistinctOn([stockPrices.stockId])
      .from(stockPrices)
      .where(inArray(stockPrices.stockId, stockIds))
      .orderBy(stockPrices.stockId, desc(stockPrices.timestamp), desc(stockPrices.id)),
    getAverageSentimentScores(stockIds),
  ]);

  const stockById = new Map(stockRows.map((s) => [s.id, s]));
  const priceByStock = new Map(priceRows.map((p) => [p.stockId, p]));

  return items
    .map((item) => {
      const stock = stockById.get(item.stockId);
      if (!stock) return null;
      const price = priceByStock.get(item.stockId);
      return {
        id: item.stockId,
        symbol: stock.symbol,
        companyName: stock.companyName,
        currentPrice: price?.lastPrice ?? 0,
        percentChange: price?.percentChange ?? 0,
        sentimentScore: sentiments.get(item.stockId) ?? null,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

/** Related stocks from the same sector, excluding a given stock. */
export async function getStocksBySector(sector: string, excludeStockId: number, limit: number = 6) {
  const db = await getDb();
  if (!db) return [];
  const sectorStocks = await db
    .select()
    .from(stocks)
    .where(eq(stocks.sector, sector))
    .limit(limit + 1);
  const filtered = sectorStocks.filter((s) => s.id !== excludeStockId).slice(0, limit);
  if (filtered.length === 0) return [];

  // Two bulk queries instead of two per related stock.
  const ids = filtered.map((s) => s.id);
  const [priceRows, predRows] = await Promise.all([
    db
      .selectDistinctOn([stockPrices.stockId])
      .from(stockPrices)
      .where(inArray(stockPrices.stockId, ids))
      .orderBy(stockPrices.stockId, desc(stockPrices.timestamp), desc(stockPrices.id)),
    db
      .selectDistinctOn([predictions.stockId])
      .from(predictions)
      .where(inArray(predictions.stockId, ids))
      .orderBy(predictions.stockId, desc(predictions.timestamp), desc(predictions.id)),
  ]);
  const priceByStock = new Map(priceRows.map((p) => [p.stockId, p]));
  const predByStock = new Map(predRows.map((p) => [p.stockId, p]));

  return filtered.map((s) => {
    const price = priceByStock.get(s.id);
    const pred = predByStock.get(s.id);
    return {
      id: s.id,
      symbol: s.symbol,
      companyName: s.companyName,
      sector: s.sector ?? '',
      lastPrice: price?.lastPrice ?? null,
      percentChange: price?.percentChange ?? null,
      signal: (pred?.signal ?? 'HOLD') as 'BUY' | 'SELL' | 'HOLD',
      strength: pred?.strength ?? 0,
    };
  });
}

// 30s in-memory cache — prevents hammering on every Dashboard poll
let _rankedCache: Awaited<ReturnType<typeof _computeAllStocksRanked>> | null = null;
let _rankedCacheTime = 0;
const RANKED_CACHE_TTL_MS = 30_000;

/**
 * Compute all stocks ranked by signal + strength.
 * Audit #6 fix: uses 4 bulk queries + in-memory join instead of N+1 per-stock queries.
 */
async function _computeAllStocksRanked() {
  const db = await getDb();
  if (!db) return [];

  // ── 1. Bulk-fetch all data in parallel ──────────────────────────────────
  // DISTINCT ON returns exactly one row per stockId — the newest — so the
  // database does the collapsing. Selecting the full tables here and reducing
  // in JS meant loading every price/prediction row ever written (~35k/day) on
  // every cache miss.
  const [allStocksData, latestPrices, latestPreds, allAccuracyData] = await Promise.all([
    db.select().from(stocks),
    db
      .selectDistinctOn([stockPrices.stockId])
      .from(stockPrices)
      .orderBy(stockPrices.stockId, desc(stockPrices.timestamp), desc(stockPrices.id)),
    db
      .selectDistinctOn([predictions.stockId])
      .from(predictions)
      .orderBy(predictions.stockId, desc(predictions.timestamp), desc(predictions.id)),
    db.select().from(accuracyTracking).orderBy(desc(accuracyTracking.createdAt!)),
  ]);

  // ── 2. Build lookup maps ────────────────────────────────────────────────
  const latestPriceByStock = new Map(latestPrices.map((p) => [p.stockId, p]));
  const latestPredByStock = new Map(latestPreds.map((p) => [p.stockId, p]));

  // Accuracy metrics per stock (last 100 records each)
  const accuracyByStock = new Map<number, { correct: number; total: number }>();
  for (const rec of allAccuracyData) {
    if (!accuracyByStock.has(rec.stockId)) {
      accuracyByStock.set(rec.stockId, { correct: 0, total: 0 });
    }
    const acc = accuracyByStock.get(rec.stockId)!;
    if (acc.total < 100) { // limit to last 100
      acc.total++;
      if (rec.isCorrect === 1) acc.correct++;
    }
  }

  // ── 3. Join in-memory ───────────────────────────────────────────────────
  const ranked = allStocksData.map((stock) => {
    const price = latestPriceByStock.get(stock.id);
    const pred = latestPredByStock.get(stock.id);
    const acc = accuracyByStock.get(stock.id);
    const totalPredictions = acc?.total ?? 0;
    const accuracy = totalPredictions >= 5 ? (acc!.correct / acc!.total) : null;

    return {
      id: stock.id,
      symbol: stock.symbol,
      companyName: stock.companyName,
      sector: stock.sector ?? '',
      lastPrice: price?.lastPrice ?? null,
      change: price?.change ?? null,
      percentChange: price?.percentChange ?? null,
      signal: (pred?.signal ?? 'HOLD') as 'BUY' | 'SELL' | 'HOLD',
      strength: pred?.strength ?? 0,
      rsi: pred?.rsi ?? null,
      macd: pred?.macd ?? null,
      technicalScore: pred?.technicalScore ?? null,
      sentimentScore: pred?.sentimentScore ?? null,
      predictedPrice: pred?.predictedPrice ?? null,
      accuracy,
      totalPredictions,
    };
  });

  // Filter out stocks that haven't been synced yet (no price data)
  const withPrices = ranked.filter((s) => s.lastPrice !== null);
  // Sort: BUY first by strength DESC, then SELL by strength DESC, then HOLD
  const order = { BUY: 0, SELL: 1, HOLD: 2 };
  return withPrices.sort((a, b) => {
    const signalDiff = order[a.signal] - order[b.signal];
    if (signalDiff !== 0) return signalDiff;
    return b.strength - a.strength;
  });
}

/** All tracked stocks with latest price + prediction + accuracy for the Market Scanner. */
export async function getAllStocksRanked() {
  if (_rankedCache && Date.now() - _rankedCacheTime < RANKED_CACHE_TTL_MS) {
    return _rankedCache;
  }
  _rankedCache = await _computeAllStocksRanked();
  _rankedCacheTime = Date.now();
  return _rankedCache;
}

/** Call after every sync cycle to bust the ranked cache so fresh data appears immediately. */
export function invalidateRankedCache() {
  _rankedCache = null;
  _rankedCacheTime = 0;
}

// ── Paper Trading Queries ──────────────────────────────────────────────────

export async function getPaperWallet(userId: number) {
  const db = await getDb();
  if (!db) return null;
  let result = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId)).limit(1);
  if (result.length === 0) {
    // Auto-initialize wallet with 1000
    const values: InsertPaperWallet = {
      userId,
      balance: 1000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.insert(paperWallets).values(values);
    result = await db.select().from(paperWallets).where(eq(paperWallets.userId, userId)).limit(1);
  }
  return result[0];
}

export async function updatePaperWalletData(userId: number, amtChange: number, isGain: boolean) {
  const db = await getDb();
  if (!db) return;
  const wallet = await getPaperWallet(userId);
  if (!wallet) return;

  const updateSet: { balance: number; totalGained?: number; totalLost?: number; updatedAt: string } = {
    balance: wallet.balance + amtChange,
    updatedAt: new Date().toISOString(),
  };

  if (isGain) {
    updateSet.totalGained = wallet.totalGained + amtChange;
  } else {
    // amtChange is negative for a loss, so we subtract to add it as a positive "lost amount" tracker
    updateSet.totalLost = wallet.totalLost - amtChange;
  }

  await db.update(paperWallets).set(updateSet).where(eq(paperWallets.userId, userId));
}

export async function refundPaperTradeCapital(userId: number, amount: number) {
  const db = await getDb();
  if (!db) return;
  const wallet = await getPaperWallet(userId);
  if (!wallet) return;

  await db.update(paperWallets)
    .set({ 
      balance: wallet.balance + amount, 
      updatedAt: new Date().toISOString() 
    })
    .where(eq(paperWallets.userId, userId));
}

export async function getActivePaperTrades(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(paperTrades).where(and(eq(paperTrades.userId, userId), eq(paperTrades.status, 'OPEN'))).orderBy(desc(paperTrades.openedAt));
}

export async function getPaperTradeHistory(userId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(paperTrades).where(and(eq(paperTrades.userId, userId), eq(paperTrades.status, 'CLOSED'))).orderBy(desc(paperTrades.closedAt)).limit(limit);
}

export async function insertPaperTrade(trade: InsertPaperTrade) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(paperTrades).values(trade).returning();
  return result[0];
}

export async function updatePaperTrade(id: number, exitPrice: number, realPnl: number, closedAt: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(paperTrades).set({ status: 'CLOSED', exitPrice, realPnl, closedAt }).where(eq(paperTrades.id, id));
}

export async function updatePaperTradeStopLoss(id: number, newStopLoss: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(paperTrades).set({ stopLoss: newStopLoss }).where(eq(paperTrades.id, id));
}

export async function executePaperTradeDeduction(userId: number, amount: number) {
  const db = await getDb();
  if (!db) return false;
  const wallet = await getPaperWallet(userId);
  if (!wallet || wallet.balance < amount) return false;

  await db.update(paperWallets).set({ 
    balance: wallet.balance - amount,
    updatedAt: new Date().toISOString()
  }).where(eq(paperWallets.userId, userId));
  return true;
}

// ── Bot State Persistent Storage ──────────────────────────────────────────

export async function getBotState(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(botState).where(eq(botState.userId, userId)).limit(1);
  return result[0] || null;
}

export async function upsertBotState(userId: number, state: Partial<InsertBotState>) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getBotState(userId);
  const now = new Date().toISOString();
  
  if (existing) {
    await db.update(botState).set({
      ...state,
      updatedAt: now
    }).where(eq(botState.userId, userId));
  } else {
    await db.insert(botState).values({
      userId,
      isActive: state.isActive ?? 0,
      globalScreenerMode: state.globalScreenerMode ?? 0,
      allocPerTrade: state.allocPerTrade ?? 10000,
      stopLossPct: state.stopLossPct ?? 2.0,
      targetPct: state.targetPct ?? 4.0,
      scalpMode: state.scalpMode ?? 0,
      updatedAt: now
    });
  }
}


/** Get all BUY/SELL predictions older than horizonMs that don't have an accuracy record. */
export async function getUnresolvedPredictions(horizonMs: number = 60 * 60 * 1000) {
  const db = await getDb();
  if (!db) return [];
  const cutoffTime = new Date(Date.now() - horizonMs).toISOString();

  const olderPreds = await db
    .select()
    .from(predictions)
    .where(
      and(
        inArray(predictions.signal, ['BUY', 'SELL']),
        lte(predictions.timestamp, cutoffTime)
      )
    );
  
  if (olderPreds.length === 0) return [];
  
  const predIds = olderPreds.map(p => p.id);
  
  const existingRecords = await db
    .select({ predictionId: accuracyTracking.predictionId })
    .from(accuracyTracking)
    .where(inArray(accuracyTracking.predictionId, predIds));
    
  const resolvedIds = new Set(existingRecords.map(r => r.predictionId));
  return olderPreds.filter(p => !resolvedIds.has(p.id));
}

/** Get the closest stock price BEFORE OR AT a given timestamp. */
export async function getPriceAtTime(stockId: number, targetTimestamp: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(stockPrices)
    .where(
      and(
        eq(stockPrices.stockId, stockId),
        lte(stockPrices.timestamp, targetTimestamp)
      )
    )
    .orderBy(desc(stockPrices.timestamp), desc(stockPrices.id))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}
