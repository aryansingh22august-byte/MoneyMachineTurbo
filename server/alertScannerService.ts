import { getDb, getAllLatestPredictions, getAllStocksWithLatestPrices, createAlert, getUserWatchlist, getWatchersForStock } from "./db";
import { Prediction, InsertAlert } from "../drizzle/schema";

let _interval: NodeJS.Timeout | null = null;
const SCAN_INTERVAL_MS = 60 * 1000; // Scan every 1 minute

export function startAlertScannerService() {
  if (_interval) return;
  console.log("[AlertScanner] Starting alert background service...");
  
  _interval = setInterval(async () => {
    try {
      await scanAndGenerateAlerts();
    } catch (err) {
      console.error("[AlertScanner] Error during scan cycle:", err);
    }
  }, SCAN_INTERVAL_MS);
}

export function stopAlertScannerService() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log("[AlertScanner] Stopped.");
  }
}

const alertedCache = new Map<string, number>();
const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours cooldown per stock per signal type

async function scanAndGenerateAlerts() {
  const db = await getDb();
  if (!db) return;

  const predictions = await getAllLatestPredictions();
  if (!predictions.length) return;

  const stocks = await getAllStocksWithLatestPrices();
  const stockMap = new Map(stocks.map(s => [s.id, s]));

  // Clean up old cache entries
  const now = Date.now();
  for (const [key, timestamp] of alertedCache.entries()) {
    if (now - timestamp > ALERT_COOLDOWN_MS) {
      alertedCache.delete(key);
    }
  }

  // Find strong signals
  const strongPredictions = predictions.filter(p => p.strength >= 85 && (p.signal === "BUY" || p.signal === "SELL"));
  if (!strongPredictions.length) return;

  // For each strong prediction, get users who have this in their watchlist
  for (const pred of strongPredictions) {
    const conditionStr = pred.signal === "BUY" ? "STRONG_BUY" : "STRONG_SELL";
    
    // Check spam filter
    const cacheKey = `${pred.stockId}_${conditionStr}`;
    if (alertedCache.has(cacheKey)) continue;

    const watchers = await getWatchersForStock(pred.stockId);
    if (!watchers.length) continue;

    const stock = stockMap.get(pred.stockId);
    if (!stock) continue;

    const emoji = pred.signal === "BUY" ? "🚀" : "📉";
    
    // Mark as alerted
    alertedCache.set(cacheKey, now);

    for (const watcher of watchers) {
      const alert: InsertAlert = {
        userId: watcher.userId,
        stockId: pred.stockId,
        alertType: "SIGNAL",
        condition: conditionStr,
        value: pred.strength,
        message: `${emoji} Strong ${pred.signal} signal detected for ${stock.symbol} (Confidence: ${pred.strength}%)`,
        isActive: 1,
        createdAt: new Date().toISOString()
      };

      await createAlert(alert);
    }
  }
}
