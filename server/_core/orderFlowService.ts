/**
 * orderFlowService.ts
 * Processes real-time ticks to calculate Buying/Selling Delta
 */

interface DeltaSnapshot {
  buyVolume: number;
  sellVolume: number;
  delta: number;
  timestamp: number;
}

const deltaCache = new Map<number, DeltaSnapshot[]>();
const WINDOW_MS = 60000; // 1 minute sliding window

export function processTickForDelta(stockId: number, price: number, volume: number, isBuyerAggressive: boolean) {
  const now = Date.now();
  let history = deltaCache.get(stockId) || [];

  // Cleanup old ticks
  history = history.filter(h => now - h.timestamp < WINDOW_MS);

  // Add new tick
  history.push({
    buyVolume: isBuyerAggressive ? volume : 0,
    sellVolume: isBuyerAggressive ? 0 : volume,
    delta: isBuyerAggressive ? volume : -volume,
    timestamp: now
  });

  deltaCache.set(stockId, history);
}

export function getCumulativeDelta(stockId: number) {
  const history = deltaCache.get(stockId) || [];
  return history.reduce((sum, h) => sum + h.delta, 0);
}

export function getDeltaPressure(stockId: number): 'high_buying' | 'high_selling' | 'neutral' {
  const history = deltaCache.get(stockId) || [];
  if (history.length === 0) return 'neutral';

  const totalBuy = history.reduce((sum, h) => sum + h.buyVolume, 0);
  const totalSell = history.reduce((sum, h) => sum + h.sellVolume, 0);
  const total = totalBuy + totalSell;

  if (total === 0) return 'neutral';
  
  const buyRatio = totalBuy / total;
  if (buyRatio > 0.7) return 'high_buying';
  if (buyRatio < 0.3) return 'high_selling';
  return 'neutral';
}
