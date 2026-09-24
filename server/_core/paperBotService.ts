import { 
    getPaperWallet, 
    getActivePaperTrades, 
    executePaperTradeDeduction, 
    insertPaperTrade, 
    updatePaperTrade,
    updatePaperWalletData,
    getAllStocksRanked,
    getLatestStockPrice,
    updatePaperTradeStopLoss,
    getBotState,
    upsertBotState
} from '../db';

// Kelly Criterion Formula: K = W - [(1 - W) / R]
function calculateKellyFraction(winProb: number, stopLossPct: number, targetPct: number) {
    const W = winProb;
    const R = targetPct / stopLossPct;
    if (R <= 0) return 0;
    
    // Half-Kelly is mathematically safer for volatile markets
    const K = W - ((1 - W) / R);
    return Math.max(0, K / 2);
}

class PaperBotService {
    private isActive = false;
    private globalScreenerMode = false;
    private config = {
        allocPerTrade: 10000,
        stopLossPct: 2.0,
        targetPct: 4.0,
        scalpMode: false
    };
    private logs: { id: string; time: string; msg: string; type: 'info' | 'trade' | 'alert' }[] = [];
    private maxLogs = 50;
    private interval: ReturnType<typeof setInterval> | null = null;
    private readonly USER_ID = 1;
    private isInitialized = false;

    constructor() {
        this.init().catch(console.error);
    }

    public async init() {
        if (this.isInitialized) return;
        
        const state = await getBotState(this.USER_ID);
        if (state) {
            this.isActive = state.isActive === 1;
            this.globalScreenerMode = state.globalScreenerMode === 1;
            this.config = {
                allocPerTrade: state.allocPerTrade,
                stopLossPct: state.stopLossPct,
                targetPct: state.targetPct,
                scalpMode: state.scalpMode === 1
            };
            this.pushLog(`Bot service restored from database. Auto-Pilot: ${this.isActive ? 'ON' : 'OFF'}, Global Screener: ${this.globalScreenerMode ? 'ON' : 'OFF'}`, 'info');
        } else {
            // First time setup, save defaults
            await this.syncStateToDb();
            this.pushLog('Bot service initialized with defaults. Standing by.', 'info');
        }
        
        this.isInitialized = true;
    }

    private async syncStateToDb() {
        await upsertBotState(this.USER_ID, {
            isActive: this.isActive ? 1 : 0,
            globalScreenerMode: this.globalScreenerMode ? 1 : 0,
            allocPerTrade: this.config.allocPerTrade,
            stopLossPct: this.config.stopLossPct,
            targetPct: this.config.targetPct,
            scalpMode: this.config.scalpMode ? 1 : 0
        });
    }

    public async toggle(state: boolean) {
        this.isActive = state;
        await this.syncStateToDb();
        if (state) {
            this.pushLog('AUTO-PILOT ENGAGED. Bot is now live trading.', 'alert');
        } else {
            this.pushLog('AUTO-PILOT DISENGAGED. Bot stopped.', 'info');
        }
    }

    public async toggleGlobalScreener(state: boolean) {
        this.globalScreenerMode = state;
        await this.syncStateToDb();
        if (state) {
            this.pushLog('GLOBAL SCREENER ENGAGED. Scanning all 50 stocks for >85% execution.', 'alert');
        } else {
            this.pushLog('GLOBAL SCREENER DISENGAGED. Bot returned to targeted mode.', 'info');
        }
    }

    public getStatus() {
        return {
            isActive: this.isActive,
            globalScreenerMode: this.globalScreenerMode,
            config: this.config,
            logs: this.logs
        };
    }

    public async updateConfig(newConfig: { allocPerTrade: number; stopLossPct: number; targetPct: number; scalpMode?: boolean }) {
        this.config = { ...this.config, ...newConfig };
        await this.syncStateToDb();
        this.pushLog(`Config updated: Alloc ₹${this.config.allocPerTrade}, SL ${this.config.stopLossPct}%, TP ${this.config.targetPct}%, Scalp ${this.config.scalpMode}`, 'info');
    }

    private pushLog(msg: string, type: 'info' | 'trade' | 'alert' = 'info') {
        const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
        this.logs.unshift({ id: Math.random().toString(36).substr(2, 9), time, msg, type });
        if (this.logs.length > this.maxLogs) {
            this.logs.pop();
        }
        console.log(`[PaperBot] ${msg}`);
    }

    public start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.processMarketTick(), 5000);
    }

    private async processMarketTick() {
        if (!this.isInitialized) return;
        
        try {
            const openTrades = await getActivePaperTrades(this.USER_ID);
            for (const trade of openTrades) {
                const livePriceData = await getLatestStockPrice(trade.stockId);
                const livePrice = livePriceData?.lastPrice;
                if (!livePrice) continue;

                // Trailing Stop Loss Logic
                // If Scalp mode is on, use ultra-tight trailing stops
                const trailingPct = this.config.scalpMode ? this.config.stopLossPct / 2 : this.config.stopLossPct;
                const dynamicStopLoss = livePrice * (1 - (trailingPct / 100));
                
                if (livePrice > trade.entryPrice && dynamicStopLoss > trade.stopLoss) {
                    trade.stopLoss = dynamicStopLoss;
                    await updatePaperTradeStopLoss(trade.id, dynamicStopLoss);
                    if (this.config.scalpMode) {
                        this.pushLog(`[${trade.symbol.replace('.NS', '')}] Micro-Trailing Stop locked profit @ ₹${dynamicStopLoss.toFixed(1)}`, 'info');
                    } else {
                        this.pushLog(`[${trade.symbol.replace('.NS', '')}] Trailing Stop-Loss updated to ₹${dynamicStopLoss.toFixed(1)}`, 'info');
                    }
                }

                if (livePrice <= trade.stopLoss) {
                    await this.closeTrade(trade, livePrice, 'STOP LOSS');
                } else if (livePrice >= trade.targetPrice) {
                    await this.closeTrade(trade, livePrice, 'TARGET HIT');
                }
            }

            if (!this.isActive) return;

            // Only auto-scan and buy if globalScreenerMode is on OR if we implement a specific watchlist mode later
            if (this.globalScreenerMode) {
                const allRanked = await getAllStocksRanked();
                
                // Targets -> BUY signal && strength >= 85 (Global Screener is strict!)
                const targets = allRanked.filter(s => s.signal === 'BUY' && (s.strength ?? 0) >= 85);
                
                for (const target of targets) {
                    if (openTrades.some(t => t.stockId === target.id)) continue;
                    await this.executeBuySignal(target);
                }
            }

        } catch (error) {
            console.error('[PaperBot] Tick processing error:', error);
        }
    }

    private async executeBuySignal(prediction: any) {
        const livePriceData = await getLatestStockPrice(prediction.id);
        const livePrice = livePriceData?.lastPrice;
        if (!livePrice) return;

        const wallet = await getPaperWallet(this.USER_ID);
        if (!wallet) return;

        // Dynamic Risk Management: Kelly Criterion Allocation
        const winProb = (prediction.strength ?? 50) / 100;
        const kellyFraction = calculateKellyFraction(winProb, this.config.stopLossPct, this.config.targetPct);
        
        // Cap max allocation at 15% of total portfolio or config max, whichever is lower
        const safeKelly = Math.min(kellyFraction, 0.15);
        let dynamicAllocation = wallet.balance * safeKelly;
        
        // Ensure we don't exceed the user's explicit allocPerTrade limit
        dynamicAllocation = Math.min(dynamicAllocation, this.config.allocPerTrade);

        if (wallet.balance < Math.min(5000, dynamicAllocation)) return; // Minimum balance check

        const allocation = Math.min(dynamicAllocation, wallet.balance);
        const qty = Math.floor(allocation / livePrice);
        
        if (qty < 1) return;

        const totalCost = qty * livePrice;
        const sl = livePrice * (1 - this.config.stopLossPct / 100);
        const tp = livePrice * (1 + this.config.targetPct / 100);
        const symbol = prediction.symbol;

        const canAfford = await executePaperTradeDeduction(this.USER_ID, totalCost);
        if (!canAfford) return;

        await insertPaperTrade({
            userId: this.USER_ID,
            stockId: prediction.id,
            symbol: symbol,
            type: 'BUY',
            status: 'OPEN',
            mode: 'AI',
            entryPrice: livePrice,
            quantity: qty,
            stopLoss: sl,
            targetPrice: tp,
            reasoning: `Auto-Bot: Swarm AI BUY Signal (Strength: ${prediction.strength}%)`,
            openedAt: new Date().toISOString(),
        });

        this.pushLog(`[${symbol}] Executed BUY of ${qty} units @ ₹${livePrice.toFixed(1)} (Strength: ${prediction.strength}%)`, 'trade');
    }

    private async closeTrade(trade: any, exitPrice: number, reason: string) {
        const realPnl = (exitPrice - trade.entryPrice) * trade.quantity;
        const isGain = realPnl >= 0;

        await updatePaperWalletData(this.USER_ID, realPnl, isGain);
        
        const { getDb } = await import('../db');
        const { paperWallets } = await import('../../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const db = await getDb();
        if (db) {
            const wallet = await getPaperWallet(this.USER_ID);
            if (wallet) {
                await db.update(paperWallets)
                    .set({ balance: wallet.balance + (trade.entryPrice * trade.quantity), updatedAt: new Date().toISOString() })
                    .where(eq(paperWallets.userId, this.USER_ID));
            }
        }

        await updatePaperTrade(trade.id, exitPrice, Math.round(realPnl * 100) / 100, new Date().toISOString());
        const pnlStr = realPnl >= 0 ? `+₹${realPnl.toFixed(2)}` : `-₹${Math.abs(realPnl).toFixed(2)}`;
        this.pushLog(`[${trade.symbol.replace('.NS', '')}] Closed on ${reason} @ ₹${exitPrice.toFixed(1)}. P&L: ${pnlStr}`, isGain ? 'trade' : 'alert');
    }

    public async squareOffAll() {
        this.pushLog('EMERGENCY SQUARE-OFF INITIATED. Exiting all positions at MARKET.', 'alert');
        const openTrades = await getActivePaperTrades(this.USER_ID);
        let totalPnl = 0;
        
        for (const trade of openTrades) {
            const livePriceData = await getLatestStockPrice(trade.stockId);
            const exitPrice = livePriceData?.lastPrice ?? trade.entryPrice;
            
            const realPnl = (exitPrice - trade.entryPrice) * trade.quantity;
            totalPnl += realPnl;
            
            await this.closeTrade(trade, exitPrice, 'MANUAL SQUARE-OFF');
        }
        
        const pnlStr = totalPnl >= 0 ? `+₹${totalPnl.toFixed(2)}` : `-₹${Math.abs(totalPnl).toFixed(2)}`;
        this.pushLog(`Square-Off Complete. Net P&L: ${pnlStr}`, 'info');
        return { success: true, totalPnl };
    }
}

export const paperBotService = new PaperBotService();
