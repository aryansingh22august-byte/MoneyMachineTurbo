import { getAllStocksWithLatestPrices, insertPaperTrade, updatePaperTrade, getActivePaperTrades, updatePaperWalletData, refundPaperTradeCapital, getPaperTradeHistory } from '../db';
import { getSwarmIntelligenceReport } from './miroFishBridge';
import { SMCReport } from './smcEngine';
import { calculatePositionSize, getSmartStopLoss } from './riskManager';

interface LiveTick {
  symbol: string;
  lastPrice: number;
  smc?: SMCReport;
}

// Keep a minimal local cache of our target conditions
const SIMULATED_SLIPPAGE = 0.0005; // 0.05% slippage
const AGGRESSIVE_CONFIDENCE_THRESHOLD = 0.65; // High velocity mode (65%+)
let lastExecutionPass = 0;

export async function processPaperTradingBot(tick: LiveTick) {
  const now = Date.now();
  // Don't fire the heavy DB check on every single tick, throttle to 1 check per 2 seconds overall
  if (now - lastExecutionPass < 2000) return;
  lastExecutionPass = now;

  try {
    // 1. Process EXITS for open trades
    const openTrades = await getActivePaperTrades(1); // Assuming userId 1 for single-user dashboard
    for (const trade of openTrades) {
      if (trade.symbol !== tick.symbol) continue;

      let exitReason: "STOP_LOSS" | "TARGET_REACHED" | null = null;
      let exitPrice = tick.lastPrice;

      // Handle slippage heavily against the user for realism
      if (trade.type === 'BUY') {
        const exitPriceWithSlippage = tick.lastPrice * (1 - SIMULATED_SLIPPAGE);
        if (exitPriceWithSlippage <= trade.stopLoss) exitReason = "STOP_LOSS";
        if (exitPriceWithSlippage >= trade.targetPrice) exitReason = "TARGET_REACHED";
        exitPrice = exitPriceWithSlippage;
      } else {
        const exitPriceWithSlippage = tick.lastPrice * (1 + SIMULATED_SLIPPAGE);
        if (exitPriceWithSlippage >= trade.stopLoss) exitReason = "STOP_LOSS";
        if (exitPriceWithSlippage <= trade.targetPrice) exitReason = "TARGET_REACHED";
        exitPrice = exitPriceWithSlippage;
      }

      if (exitReason) {
        // Calculate PnL
        const valuePnl = trade.type === 'BUY' 
          ? (exitPrice - trade.entryPrice) * trade.quantity
          : (trade.entryPrice - exitPrice) * trade.quantity;
        
        await updatePaperTrade(trade.id, exitPrice, valuePnl, new Date().toISOString());
        // Refund the original margin/capital back to the wallet
        await refundPaperTradeCapital(1, trade.entryPrice * trade.quantity);
        // Add or subtract the realized PnL
        await updatePaperWalletData(1, valuePnl, valuePnl >= 0);
        console.log(`[Bot] Closed Trade: ${trade.symbol} (${exitReason}) | PnL: ₹${valuePnl.toFixed(2)}`);
      }
    }

    // 2. Process ENTRIES based on Swarm
    const swarmReport = await getSwarmIntelligenceReport();
    if (!swarmReport || swarmReport.predictions.length === 0) return;

    // We scan for predictions matching our current live tick symbol
    const relevantPredictions = swarmReport.predictions.flatMap(p => 
      p.affectedStocks.filter(s => tick.symbol.includes(s.symbol))
    );

    if (relevantPredictions.length === 0) return;
    
    // Pick the strongest prediction for this tick
    const prediction = relevantPredictions.sort((a,b) => b.confidence - a.confidence)[0];

    // Aggressive entry check
    if (prediction.confidence >= AGGRESSIVE_CONFIDENCE_THRESHOLD && prediction.direction !== 'NEUTRAL') {
      
      // Prevent duplicate open trades on the same stock
      if (openTrades.some(t => t.symbol === tick.symbol)) return;

      // Cooldown check to prevent Revenge Trading (Infinite Loop on same Swarm Report)
      const tradeHistory = await getPaperTradeHistory(1, 50);
      const alreadyTraded = tradeHistory.some(t => 
        t.symbol === tick.symbol && 
        new Date(t.openedAt).getTime() >= new Date(swarmReport.simulationRunAt).getTime()
      );
      if (alreadyTraded) return;

      const latestPrices = await getAllStocksWithLatestPrices();
      const stockMeta = latestPrices.find(s => tick.symbol.includes(s.symbol));
      if (!stockMeta) return;

      const type = prediction.direction === 'UP' ? 'BUY' : 'SELL';
      
      // ── SMC Filter: Best Execution logic ──────────────────────────────────
      let executionPrice = tick.lastPrice;
      let usedSMC = false;

      if (tick.smc && tick.smc.fvgs.length > 0) {
        const activeFVG = tick.smc.fvgs[0]; // Nearest imbalance
        if (type === 'BUY' && activeFVG.type === 'bullish' && tick.lastPrice > activeFVG.top) {
          // Price is above the FVG — wait for retest (Limit entry at FVG Top)
          executionPrice = activeFVG.top;
          usedSMC = true;
        } else if (type === 'SELL' && activeFVG.type === 'bearish' && tick.lastPrice < activeFVG.bottom) {
          // Price is below the FVG — wait for retest (Limit entry at FVG Bottom)
          executionPrice = activeFVG.bottom;
          usedSMC = true;
        }
      }

      // If we are using SMC but the price hasn't hit our limit yet, we skip this tick
      // However, if we don't have SMC data yet or it's already in the zone, we use a hybrid entry
      if (usedSMC && Math.abs(tick.lastPrice - executionPrice) / executionPrice > 0.005) {
        // Price is more than 0.5% away from our "Institutional Entry" zone
        // We log it and wait. In a real system, we'd place a Limit Order.
        return; 
      }

      // Calculate realistic entry with slippage
      const entryPrice = type === 'BUY' 
        ? executionPrice * (1 + SIMULATED_SLIPPAGE) 
        : executionPrice * (1 - SIMULATED_SLIPPAGE);

      // Determine SL/TP mode.
      const smartSL = getSmartStopLoss(
        type, 
        entryPrice, 
        tick.smc?.fvgs[0]?.bottom, // FVG bottom for Buy
        undefined, // We can add swing lows later
        0.015      // 1.5% default if no SMC
      );

      // Dynamic Position Sizing based on Risk
      const riskResults = calculatePositionSize(entryPrice, smartSL);
      const quantity = riskResults.quantity;

      // Determine Target Price (Fixed 2% or 2x Risk)
      const riskAmt = Math.abs(entryPrice - smartSL);
      const targetPrice = type === 'BUY' 
        ? entryPrice + (riskAmt * 2.5) // 1:2.5 Risk/Reward
        : entryPrice - (riskAmt * 2.5);

      await insertPaperTrade({
        userId: 1, 
        stockId: stockMeta.id,
        symbol: tick.symbol,
        type,
        status: 'OPEN',
        mode: 'AI_SMC', 
        entryPrice,
        quantity,
        stopLoss: smartSL,
        targetPrice,
        openedAt: new Date().toISOString(),
        reasoning: `SMC Institutional Entry. Risk: ₹${riskResults.actualRisk.toFixed(0)}. Conf: ${(prediction.confidence * 100).toFixed(0)}%.`
      });

      console.log(`[Bot] Opened Trade: ${type} ${quantity}x ${tick.symbol} @ ₹${entryPrice.toFixed(2)}`);
    }
  } catch (error) {
    console.error("[PaperTradingBot] Check loop error:", error);
  }
}
