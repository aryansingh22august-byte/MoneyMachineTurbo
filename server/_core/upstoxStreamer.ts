import UpstoxClient from 'upstox-js-sdk';
import { getUpstoxAccessToken } from './upstoxAuth';
import { broadcastSentimentUpdate } from './realtimeUpdateServer';
import { broadcastLiveUpdate } from './realTimeService';
import { getSMCReport } from './stockDataService';
import { getCumulativeDelta, getDeltaPressure } from './orderFlowService';
import * as protobuf from 'protobufjs';
import * as path from 'path';
import { processPaperTradingBot } from './paperTradingBot';
import { processTickForDelta } from './orderFlowService';
import { getAllStocks, insertStockPrice, getLatestStockPrice } from '../db';

// Map symbol → Upstox ISIN code
const SYMBOL_TO_ISIN: Record<string, string> = {
  "RELIANCE.NS": "INE002A01018",
  "TCS.NS": "INE467B01029",
  "HDFCBANK.NS": "INE040A01034",
  "INFY.NS": "INE009A01021",
  "ICICIBANK.NS": "INE090A01021",
  "SBIN.NS": "INE062A01020",
  "LT.NS": "INE018A01030",
  "ITC.NS": "INE154A01025",
  "TATAMOTORS.NS": "INE155A01022",
  "TATASTEEL.NS": "INE081A01020",
  "HCLTECH.NS": "INE361B01024",
  "WIPRO.NS": "INE075A01022",
  "TECHM.NS": "INE669C01036",
  "BAJFINANCE.NS": "INE476A01022",
  "BAJAJFINSV.NS": "INE918I01026",
  "HDFCLIFE.NS": "INE795G01014",
  "SBILIFE.NS": "INE123W01016",
  "AXISBANK.NS": "INE038A01020",
  "KOTAKBANK.NS": "INE237A01028",
  "ONGC.NS": "INE213A01029",
  "BPCL.NS": "INE541A01028",
  "NTPC.NS": "INE733E01010",
  "POWERGRID.NS": "INE752E01010",
  "COALINDIA.NS": "INE522F01014",
  "BHARTIARTL.NS": "INE397D01024",
  "MARUTI.NS": "INE585B01010",
  "BAJAJ-AUTO.NS": "INE917I01010",
  "HEROMOTOCO.NS": "INE158A01026",
  "EICHERMOT.NS": "INE066A01021",
  "M&M.NS": "INE101A01026",
  "HINDUNILVR.NS": "INE030A01027",
  "NESTLEIND.NS": "INE239A01016",
  "BRITANNIA.NS": "INE216A01030",
  "TATACONSUM.NS": "INE192A01025",
  "SUNPHARMA.NS": "INE044A01036",
  "DRREDDY.NS": "INE089A01023",
  "DIVISLAB.NS": "INE361B01024",
  "CIPLA.NS": "INE059A01026",
  "APOLLOHOSP.NS": "INE437A01024",
  "JSWSTEEL.NS": "INE114A01011",
  "HINDALCO.NS": "INE038A01020",
  "ULTRACEMCO.NS": "INE481G01011",
  "GRASIM.NS": "INE047A01021",
  "TITAN.NS": "INE280A01028",
  "ASIANPAINT.NS": "INE021A01026",
  "ADANIPORTS.NS": "INE742F01042",
  "ADANIENT.NS": "INE423A01024",
  "UPL.NS": "INE628A01036",
  "INDUSINDBK.NS": "INE095A01012",
};

export const UPSTOX_INSTRUMENT_MAP: Record<number, string> = {};
const INSTRUMENT_TO_STOCK_ID = new Map<string, number>();
const STOCK_ID_TO_SYMBOL: Record<number, string> = {};

export async function initUpstoxStreamerMaps() {
  try {
    const allStocks = await getAllStocks();
    for (const s of allStocks) {
      const isin = SYMBOL_TO_ISIN[s.symbol] || SYMBOL_TO_ISIN[`${s.symbol}.NS`];
      if (isin) {
        const key = `NSE_EQ|${isin}`;
        UPSTOX_INSTRUMENT_MAP[s.id] = key;
        INSTRUMENT_TO_STOCK_ID.set(key, s.id);
        STOCK_ID_TO_SYMBOL[s.id] = s.symbol.replace(/\.NS$/i, '');
      }
    }
    console.log(`[Upstox Streamer] Dynamically mapped ${Object.keys(UPSTOX_INSTRUMENT_MAP).length} stocks from DB.`);
  } catch (err) {
    console.error('[Upstox Streamer] Failed to initialize dynamic stock mapping:', err);
  }
}

let streamer: any = null;
let isConnected = false;
let lastTickTime = 0;
let fallbackInterval: NodeJS.Timeout | null = null;
let protobufRoot: protobuf.Root | null = null;

// ── Rate-limiting: track last DB write time per stock (max 1 write per 60s) ──
// This prevents hammering the DB with 50 writes/second during market hours
const DB_WRITE_INTERVAL_MS = 60_000; // 1 minute per stock
const lastDbWriteTime = new Map<number, number>();

// ── After-hours fallback: cache real DB prices on startup ──────────────────
// Populated once at boot from DB, updated on every real DB write
const lastKnownPrices = new Map<number, { lastPrice: number; change: number; percentChange: number }>();

/** Exported so index.ts retry loop can check actual connection state */
export function isUpstoxConnected(): boolean { return isConnected; }

/** Load real last-known prices from DB for all tracked stocks.
 *  Called once at boot so the fallback simulator has real prices to use.
 */
async function loadLastKnownPricesFromDb(): Promise<void> {
  const stockIds = Object.keys(UPSTOX_INSTRUMENT_MAP).map(Number);
  for (const stockId of stockIds) {
    try {
      const row = await getLatestStockPrice(stockId);
      if (row && row.lastPrice) {
        lastKnownPrices.set(stockId, {
          lastPrice: row.lastPrice,
          change: row.change ?? 0,
          percentChange: row.percentChange ?? 0,
        });
      }
    } catch {
      // Non-fatal — if DB is slow, just skip this stock
    }
  }
  console.log(`[Upstox Streamer] Loaded last-known prices for ${lastKnownPrices.size} stocks from DB.`);
}

/** Load the protobuf schema once */
async function loadProtobufSchema(): Promise<void> {
  if (protobufRoot) return;
  try {
    const protoPath = path.join(__dirname, 'marketDataFeed.proto');
    protobufRoot = await protobuf.load(protoPath);
    console.log('[Upstox Streamer] Protobuf schema loaded successfully');
  } catch (err) {
    console.error('[Upstox Streamer] Failed to load protobuf schema:', err);
  }
}

export async function connectUpstoxStreamer() {
  const token = getUpstoxAccessToken();
  if (!token) {
    // Waiting for user to login via /api/upstox/login
    return;
  }

  if (streamer || isConnected) {
    return; // Already initialized
  }

  // Load dynamic stock maps and protobuf schema
  await initUpstoxStreamerMaps();
  await loadProtobufSchema();
  await loadLastKnownPricesFromDb();

  // Always boot the 24/7 After-Hours Simulator
  if (!fallbackInterval) {
    console.log("[Upstox Streamer] After-Hours Fallback Simulator active.");
    fallbackInterval = setInterval(() => {
      // If real feed is silent for more than 10 seconds, fire fallback ticks
      if (Date.now() - lastTickTime > 10_000) {
        broadcastSimulatedTicks();
      }
    }, 3000);
  }

  try {
    const defaultClient = UpstoxClient.ApiClient.instance;
    const OAUTH2 = defaultClient.authentications['OAUTH2'];
    OAUTH2.accessToken = token;

    streamer = new UpstoxClient.MarketDataStreamerV3();

    streamer.on('open', () => {
      isConnected = true;
      console.log("[Upstox Streamer] ✅ Connected to Upstox Market Data WebSocket");
      const instruments = Object.values(UPSTOX_INSTRUMENT_MAP);
      streamer.subscribe(instruments, "full");
      console.log(`[Upstox Streamer] Subscribed to ${instruments.length} live instruments.`);
    });

    streamer.on('message', (data: Buffer | ArrayBuffer | string) => {
      lastTickTime = Date.now(); // Register real tick heartbeat
      processRealUpstoxTick(data);
    });

    streamer.on('error', (err: any) => console.error("[Upstox Streamer] WebSocket Error:", err));
    streamer.on('close', () => {
      console.log("[Upstox Streamer] Connection Closed");
      isConnected = false;
      streamer = null;
    });

    streamer.connect();
    
    console.log("[Upstox Streamer] Initialization requested...");
  } catch (error) {
    console.error("[Upstox Streamer] Initialization failed:", error);
  }
}

/** Decode real Upstox protobuf binary tick and route to broadcast. Audit #2 fix. */
function processRealUpstoxTick(data: Buffer | ArrayBuffer | string) {
  if (!protobufRoot) {
    console.warn('[Upstox Streamer] Protobuf schema not loaded — skipping tick');
    return;
  }

  try {
    // Convert to Buffer if needed
    let buffer: Uint8Array;
    if (data instanceof ArrayBuffer) {
      buffer = new Uint8Array(data);
    } else if (typeof data === 'string') {
      // If the SDK already decoded to JSON string, parse directly
      try {
        const jsonData = JSON.parse(data);
        processDecodedFeed(jsonData);
        return;
      } catch {
        buffer = Buffer.from(data, 'binary');
      }
    } else {
      buffer = data;
    }

    // Decode protobuf
    const FeedResponse = protobufRoot.lookupType('com.upstox.marketdatafeeder.rpc.proto.FeedResponse');
    const decoded = FeedResponse.decode(buffer);
    const feedObj = FeedResponse.toObject(decoded, { defaults: true, longs: Number });
    processDecodedFeed(feedObj);
  } catch (error: any) {
    console.warn('[Upstox Streamer] Failed to decode tick:', error?.message);
  }
}

/** Process decoded feed data and broadcast real prices */
function processDecodedFeed(feedObj: any) {
  const feeds = feedObj?.feeds;
  if (!feeds || typeof feeds !== 'object') return;

  for (const [instrumentKey, feed] of Object.entries(feeds)) {
    const stockId = INSTRUMENT_TO_STOCK_ID.get(instrumentKey);
    if (stockId === undefined) continue; // Unknown instrument

    const ff = (feed as any)?.ff;
    if (!ff) continue;

    // Extract LTPC (Last Trade Price/Close) accurately
    let ltp = 0;
    let closePrice = 0;
    let volume = 0;

    const ltpc = ff?.marketFF?.ltpc ?? ff?.indexFF?.ltpc;
    if (ltpc) {
      if (ltpc.ltp && ltpc.ltp > 0) ltp = ltpc.ltp;
      if (ltpc.cp && ltpc.cp > 0) closePrice = ltpc.cp;
    }

    const ext = ff?.eFeedDetails;
    if (ext) {
      if (ext.atp && ext.atp > 0 && !ltp) ltp = ext.atp;
      if (ext.close && ext.close > 0 && !closePrice) closePrice = ext.close;
      if (ext.vtt && ext.vtt > 0) volume = ext.vtt;
    }

    const ohlcList = ff?.marketOHLC?.ohlc;
    if (Array.isArray(ohlcList) && ohlcList.length > 0) {
      const dailyOhlc = ohlcList.find((o: any) => o.interval === '1d') ?? ohlcList[0];
      if (!ltp && dailyOhlc.close) ltp = dailyOhlc.close;
      if (!closePrice && dailyOhlc.open) closePrice = dailyOhlc.open;
      if (!volume && dailyOhlc.volume) volume = dailyOhlc.volume;
    }

    if (ltp <= 0) continue; // No valid price

    // Track Delta
    const previousLtp = (lastKnownPrices.get(stockId))?.lastPrice || 0;
    if (previousLtp > 0 && ltp !== previousLtp && volume > 0) {
      processTickForDelta(stockId, ltp, volume, ltp > previousLtp);
    }

    const change = closePrice > 0 ? ltp - closePrice : 0;
    const percentChange = closePrice > 0 ? (change / closePrice) * 100 : 0;
    const symbol = STOCK_ID_TO_SYMBOL[stockId] ?? `Stock#${stockId}`;

    // ── Update in-memory price cache ───────────────────────────────────────
    lastKnownPrices.set(stockId, { lastPrice: ltp, change, percentChange });

    // ── Broadcast real price via SSE to all connected dashboard clients ─────
    broadcastLiveUpdate({
      stockId,
      symbol,
      lastPrice: ltp,
      change,
      percentChange,
      volume,
      signal: percentChange > 0.5 ? 'BUY' : percentChange < -0.5 ? 'SELL' : 'HOLD',
      strength: Math.min(100, Math.round(Math.abs(percentChange) * 10 + 30)),
      predictedPrice: ltp * (1 + percentChange / 200), // Simple projection
      rsi: 50, // Will be computed by Yahoo sync cycle
      macd: 0,
      sma20: ltp,
      sma50: ltp,
      timestamp: new Date().toISOString(),
      smc: getSMCReport(stockId),
      orderFlow: {
        delta: getCumulativeDelta(stockId),
        pressure: getDeltaPressure(stockId)
      }
    });

    // Output to paper trading bot (always on every tick)
    void processPaperTradingBot({ 
      symbol, 
      lastPrice: ltp,
      smc: getSMCReport(stockId)
    }).catch(err => {
      console.error('[Bot] Execution error:', err);
    });

    // ── Rate-limited DB write: max once per 60 seconds per stock ───────────
    // This keeps the Market Scanner, Pro Algo, and all DB-backed views in sync
    // without hammering the database at 50 writes/second.
    const now = Date.now();
    const lastWrite = lastDbWriteTime.get(stockId) ?? 0;
    if (now - lastWrite >= DB_WRITE_INTERVAL_MS) {
      lastDbWriteTime.set(stockId, now);
      // Fire-and-forget — never block the tick processing loop
      void insertStockPrice({
        stockId,
        lastPrice: ltp,
        change,
        percentChange,
        volume,
        open: closePrice, // best available open proxy
        high: ltp,
        low: ltp,
        previousClose: closePrice || undefined,
        timestamp: new Date().toISOString(),
      }).catch(err => {
        console.warn(`[Upstox Streamer] DB write failed for stock ${stockId}:`, err?.message);
      });
    }
  }
}

/** Fallback: simulated ticks for after-hours or when Upstox is disconnected.
 *  Uses real last-known prices from DB instead of fake stockId*500 formulas.
 */
function broadcastSimulatedTicks() {
  // Only simulate for stocks we have real prices for
  for (const [stockId, priceData] of lastKnownPrices) {
    // Only simulate a small random walk (±0.05%) — cosmetic only, no false signals
    const microNoise = (Math.random() - 0.5) * priceData.lastPrice * 0.0005;
    const simulatedLtp = parseFloat((priceData.lastPrice + microNoise).toFixed(2));

    broadcastLiveUpdate({
      stockId,
      symbol: STOCK_ID_TO_SYMBOL[stockId] ?? `Stock#${stockId}`,
      lastPrice: simulatedLtp,
      change: priceData.change,
      percentChange: priceData.percentChange,
      volume: 0,
      signal: 'HOLD',
      strength: 30,
      predictedPrice: simulatedLtp,
      rsi: 50,
      macd: 0,
      sma20: simulatedLtp,
      sma50: simulatedLtp,
      timestamp: new Date().toISOString(),
    });
  }
}
