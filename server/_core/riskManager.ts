/**
 * riskManager.ts
 * Professional Risk Management & Position Sizing Engine
 */

export interface RiskProfile {
  riskPerTrade: number; // e.g. 50 INR
  maxAllocPerTrade: number; // e.g. 1000 INR
  minRR: number; // e.g. 1.5
}

export const DEFAULT_RISK: RiskProfile = {
  riskPerTrade: 50,
  maxAllocPerTrade: 1000,
  minRR: 1.5
};

/**
 * Calculates the optimal position size based on risk-per-trade.
 * shares = risk_amount / (entry - stop_loss)
 */
export function calculatePositionSize(
  entry: number, 
  stopLoss: number, 
  profile: RiskProfile = DEFAULT_RISK
): { quantity: number; actualRisk: number; totalCost: number } {
  
  const riskPerShare = Math.abs(entry - stopLoss);
  if (riskPerShare === 0) return { quantity: 1, actualRisk: 0, totalCost: entry };

  // Calculate quantity based on risk amount
  let quantity = Math.floor(profile.riskPerTrade / riskPerShare);

  // Cap quantity by max allocation
  const maxQtyByAlloc = Math.floor(profile.maxAllocPerTrade / entry);
  quantity = Math.min(quantity, maxQtyByAlloc);

  // Minimum 1 share
  if (quantity < 1) quantity = 1;

  return {
    quantity,
    actualRisk: quantity * riskPerShare,
    totalCost: quantity * entry
  };
}

/**
 * Determines a 'Smart Stop Loss' based on market structure (SMC)
 */
export function getSmartStopLoss(
  type: 'BUY' | 'SELL',
  entry: number,
  fvgLow?: number,
  swingLow?: number,
  defaultPct = 0.02
): number {
  if (type === 'BUY') {
    // Priority: 1. Swing Low (most secure), 2. FVG bottom, 3. Fixed %
    const sl = swingLow || fvgLow || (entry * (1 - defaultPct));
    // Ensure SL is actually below entry
    return Math.min(sl, entry * 0.995); 
  } else {
    // SELL/Short
    const sl = swingLow || fvgLow || (entry * (1 + defaultPct));
    return Math.max(sl, entry * 1.005);
  }
}
