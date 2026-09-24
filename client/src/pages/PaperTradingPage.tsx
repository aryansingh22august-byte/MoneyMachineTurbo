/**
 * Paper Trading Dashboard
 * Virtual portfolio with ₹1,00,000 starting balance.
 * Place BUY/SELL trades on any NSE stock, track live unrealised P&L,
 * and close positions manually.
 */

import React, { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useLivePriceUpdates } from '@/hooks/useRealtimeUpdates';
import { formatDistanceToNow } from 'date-fns';
import {
  TrendingUp, TrendingDown, Wallet, Target, ShieldAlert,
  PlusCircle, X, RefreshCw, History, Activity, RotateCcw,
  Zap, ChevronUp, ChevronDown, CheckCircle, TerminalSquare, Settings
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── NSE stock universe ──────────────────────────────────────────────────────
const NSE_STOCKS = [
  { label: 'ADANIGREEN', value: 'ADANIGREEN.NS', id: 1 },
  { label: 'MGL', value: 'MGL.NS', id: 2 },
  { label: 'NTPC', value: 'NTPC.NS', id: 3 },
  { label: 'ATGL', value: 'ATGL.NS', id: 4 },
  { label: 'BPCL', value: 'BPCL.NS', id: 5 },
  { label: 'RELIANCE', value: 'RELIANCE.NS', id: 6 },
  { label: 'TCS', value: 'TCS.NS', id: 7 },
  { label: 'HDFCBANK', value: 'HDFCBANK.NS', id: 8 },
  { label: 'INFY', value: 'INFY.NS', id: 9 },
  { label: 'ICICIBANK', value: 'ICICIBANK.NS', id: 10 },
  { label: 'SBIN', value: 'SBIN.NS', id: 11 },
  { label: 'WIPRO', value: 'WIPRO.NS', id: 12 },
  { label: 'BHARTIARTL', value: 'BHARTIARTL.NS', id: 13 },
  { label: 'BAJFINANCE', value: 'BAJFINANCE.NS', id: 14 },
  { label: 'MARUTI', value: 'MARUTI.NS', id: 15 },
];

// ── P&L badge ───────────────────────────────────────────────────────────────
function PnlBadge({ value }: { value: number }) {
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-black tabular-nums text-sm px-2 py-0.5 rounded-lg ${
      isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
    }`}>
      {isUp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      {isUp ? '+' : ''}₹{Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

// ── Open Position Card ───────────────────────────────────────────────────────
function PositionCard({ trade, onClose }: { trade: any; onClose: (id: number, price: number) => void }) {
  const { prices } = useLivePriceUpdates();
  const livePrice = prices.get(trade.stockId)?.lastPrice ?? trade.entryPrice;
  const unrealisedPnl = (livePrice - trade.entryPrice) * trade.quantity;
  const unrealisedPct = ((livePrice - trade.entryPrice) / trade.entryPrice * 100);
  const isUp = unrealisedPnl >= 0;
  const hitTarget = livePrice >= trade.targetPrice;
  const hitStopLoss = livePrice <= trade.stopLoss;

  return (
    <div className={`relative bg-gray-900/70 border rounded-xl p-4 transition-all ${
      hitTarget ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]' :
      hitStopLoss ? 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.1)]' :
      'border-gray-800 hover:border-gray-700'
    }`}>
      {/* Status badge */}
      {hitTarget && (
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-1 rounded-full border border-emerald-500/30">
          <CheckCircle className="h-3 w-3" /> TARGET HIT
        </div>
      )}
      {hitStopLoss && !hitTarget && (
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-red-500/20 text-red-400 text-[10px] font-black px-2 py-1 rounded-full border border-red-500/30">
          <ShieldAlert className="h-3 w-3" /> STOP TRIGGERED
        </div>
      )}

      <div className="flex items-start gap-3 mb-3">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
          trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {trade.type === 'BUY' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-white text-lg">{trade.symbol.replace('.NS', '')}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
              trade.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>{trade.type}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-gray-800 text-gray-500">
              {trade.quantity} shares
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 italic">"{trade.reasoning}"</div>
        </div>
      </div>

      {/* Price row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-gray-800/60 rounded-lg p-2 text-center">
          <div className="text-[9px] text-gray-600 font-bold uppercase mb-1">Entry</div>
          <div className="text-xs font-mono font-bold text-white">₹{trade.entryPrice.toFixed(1)}</div>
        </div>
        <div className={`rounded-lg p-2 text-center ${isUp ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          <div className="text-[9px] text-gray-600 font-bold uppercase mb-1">Now</div>
          <div className={`text-xs font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>₹{livePrice.toFixed(1)}</div>
        </div>
        <div className="bg-emerald-900/20 rounded-lg p-2 text-center">
          <div className="text-[9px] text-gray-600 font-bold uppercase mb-1 flex items-center justify-center gap-0.5"><Target className="h-2.5 w-2.5" /> TP</div>
          <div className="text-xs font-mono font-bold text-emerald-400">₹{trade.targetPrice.toFixed(0)}</div>
        </div>
        <div className="bg-red-900/20 rounded-lg p-2 text-center">
          <div className="text-[9px] text-gray-600 font-bold uppercase mb-1 flex items-center justify-center gap-0.5"><ShieldAlert className="h-2.5 w-2.5" /> SL</div>
          <div className="text-xs font-mono font-bold text-red-400">₹{trade.stopLoss.toFixed(0)}</div>
        </div>
      </div>

      {/* P&L + Close */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-gray-600 font-bold uppercase mb-1">Unrealised P&L</div>
          <div className="flex items-center gap-2">
            <PnlBadge value={unrealisedPnl} />
            <span className={`text-xs font-bold ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
              ({isUp ? '+' : ''}{unrealisedPct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <button
          onClick={() => onClose(trade.id, livePrice)}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-500/50 text-gray-300 hover:text-red-400 rounded-lg text-xs font-bold transition-all"
        >
          <X className="h-3.5 w-3.5" /> Close @ ₹{livePrice.toFixed(1)}
        </button>
      </div>

      {/* Opened time */}
      <div className="mt-2 text-[10px] text-gray-700">
        Opened {formatDistanceToNow(new Date(trade.openedAt), { addSuffix: true })}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function PaperTradingPage() {
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({
    stockIdx: 0,
    type: 'BUY' as 'BUY' | 'SELL',
    entryPrice: '',
    quantity: '1',
    stopLossPct: '2',
    targetPct: '4',
    reasoning: '',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [configForm, setConfigForm] = useState({
    allocPerTrade: '10000',
    stopLossPct: '2.0',
    targetPct: '4.0',
  });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const utils = trpc.useUtils();
  const { data: wallet, refetch: refetchWallet } = trpc.trading.getWallet.useQuery(undefined, { refetchInterval: 5000 });
  const { data: openTrades, refetch: refetchTrades } = trpc.trading.getActiveTrades.useQuery(undefined, { refetchInterval: 3000 });
  const { data: history } = trpc.trading.getTradeHistory.useQuery({ limit: 50 }, { refetchInterval: 10000 });

  const placeTrade = trpc.trading.placeTrade.useMutation({
    onSuccess: () => {
      refetchWallet(); refetchTrades();
      setShowPlaceOrder(false);
      showToast('Trade placed successfully! 🎯', 'success');
    },
    onError: (e) => showToast(e.message, 'error'),
  });

  const closeTrade = trpc.trading.closeTrade.useMutation({
    onSuccess: (data) => {
      refetchWallet(); refetchTrades();
      const pnl = data?.pnl ?? 0;
      showToast(`Trade closed. P&L: ${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`, pnl >= 0 ? 'success' : 'error');
    },
    onError: (e) => showToast(e.message, 'error'),
  });

  const resetWallet = trpc.trading.resetWallet.useMutation({
    onSuccess: () => { refetchWallet(); refetchTrades(); showToast('Wallet reset to ₹1,00,000 ✓', 'success'); },
  });

  const { data: botStatus, refetch: refetchBotStatus } = trpc.trading.getBotStatus.useQuery(undefined, { refetchInterval: 2000 });
  
  React.useEffect(() => {
    if (botStatus?.config && !showSettings) {
      setConfigForm({
        allocPerTrade: botStatus.config.allocPerTrade.toString(),
        stopLossPct: botStatus.config.stopLossPct.toString(),
        targetPct: botStatus.config.targetPct.toString(),
      });
    }
  }, [botStatus?.config, showSettings]);

  const toggleBot = trpc.trading.toggleBot.useMutation({
    onSuccess: () => refetchBotStatus(),
  });

  const updateBotConfig = trpc.trading.updateBotConfig.useMutation({
    onSuccess: () => {
      refetchBotStatus();
      setShowSettings(false);
      showToast('Bot settings updated ⚙️', 'success');
    },
    onError: (e) => showToast(e.message, 'error'),
  });

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleClose = (tradeId: number, livePrice: number) => {
    if (window.confirm(`Close at ₹${livePrice.toFixed(2)}?`)) {
      closeTrade.mutate({ tradeId, exitPrice: livePrice });
    }
  };

  // Compute portfolio P&L from live prices
  const { prices } = useLivePriceUpdates();
  const portfolioStats = useMemo(() => {
    if (!openTrades) return { totalPnl: 0, totalInvested: 0, numPositions: 0 };
    let totalPnl = 0, totalInvested = 0;
    for (const t of openTrades) {
      const live = prices.get(t.stockId)?.lastPrice ?? t.entryPrice;
      totalPnl += (live - t.entryPrice) * t.quantity;
      totalInvested += t.entryPrice * t.quantity;
    }
    return { totalPnl, totalInvested, numPositions: openTrades.length };
  }, [openTrades, prices]);

  const totalBalance = (wallet?.balance ?? 0) + portfolioStats.totalInvested + portfolioStats.totalPnl;
  const totalPnlAllTime = (wallet?.totalGained ?? 0) - (wallet?.totalLost ?? 0);
  const selectedStock = NSE_STOCKS[orderForm.stockIdx];
  const entryPrice = parseFloat(orderForm.entryPrice) || 0;
  const qty = parseInt(orderForm.quantity) || 1;
  const totalCost = entryPrice * qty;
  const sl = entryPrice > 0 ? entryPrice * (1 - parseFloat(orderForm.stopLossPct) / 100) : 0;
  const tp = entryPrice > 0 ? entryPrice * (1 + parseFloat(orderForm.targetPct) / 100) : 0;

  return (
    <div className="min-h-screen bg-[#050508] text-white p-6 space-y-6">

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-2 animate-in slide-in-from-top-2 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-900/90 border border-emerald-500/50 text-emerald-300' : 'bg-red-900/90 border border-red-500/50 text-red-300'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            <Wallet className="h-8 w-8 text-yellow-400" />
            Paper Trading
          </h1>
          <p className="text-gray-500 text-sm mt-1">Virtual ₹1,00,000 portfolio · Real NSE live prices · Zero risk</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => toggleBot.mutate({ state: !botStatus?.isActive })}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-black transition-all ${
                botStatus?.isActive 
                  ? 'bg-emerald-900/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Zap className={`h-4 w-4 ${botStatus?.isActive ? 'text-yellow-400' : ''}`} />
              {botStatus?.isActive ? 'Auto-Pilot ON' : 'Turn Auto-Pilot ON'}
            </button>
            <div className="w-px bg-gray-700"></div>
            <button 
              onClick={() => setShowSettings(true)}
              className="px-3 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
          <div className="w-px h-8 bg-gray-800 mx-1"></div>
          <button
            onClick={() => { refetchWallet(); refetchTrades(); }}
            className="p-2.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white border border-gray-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => resetWallet.mutate({ amount: 100000 })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white border border-gray-700 text-sm font-bold transition-colors"
          >
            <RotateCcw className="h-4 w-4" /> Reset ₹1L
          </button>
          <button
            onClick={() => setShowPlaceOrder(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-sm shadow-lg shadow-indigo-500/20 transition-all"
          >
            <PlusCircle className="h-4 w-4" /> Place Trade
          </button>
        </div>
      </div>

      {/* ── Wallet Stats Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1">Portfolio Value</div>
            <div className="text-2xl font-black text-white tabular-nums">
              ₹{totalBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-gray-600 mt-1">Cash + Positions</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900/60 border-gray-800">
          <CardContent className="p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1">Available Cash</div>
            <div className="text-2xl font-black text-indigo-400 tabular-nums">
              ₹{(wallet?.balance ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-gray-600 mt-1">{portfolioStats.numPositions} open positions</div>
          </CardContent>
        </Card>
        <Card className={`border ${portfolioStats.totalPnl >= 0 ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-red-950/20 border-red-900/30'}`}>
          <CardContent className="p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1">Unrealised P&L</div>
            <div className={`text-2xl font-black tabular-nums ${portfolioStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolioStats.totalPnl >= 0 ? '+' : ''}₹{portfolioStats.totalPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-gray-600 mt-1">Open positions</div>
          </CardContent>
        </Card>
        <Card className={`border ${totalPnlAllTime >= 0 ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-red-950/20 border-red-900/30'}`}>
          <CardContent className="p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1">Realised P&L</div>
            <div className={`text-2xl font-black tabular-nums ${totalPnlAllTime >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnlAllTime >= 0 ? '+' : ''}₹{totalPnlAllTime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[10px] text-gray-600 mt-1">All closed trades</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center border-b border-gray-800 gap-1">
        {(['positions', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-colors capitalize ${
              activeTab === tab ? 'border-indigo-500 text-white' : 'border-transparent text-gray-600 hover:text-gray-300'
            }`}
          >
            {tab === 'positions' ? <Activity className="h-4 w-4" /> : <History className="h-4 w-4" />}
            {tab === 'positions' ? `Open Positions (${openTrades?.length ?? 0})` : 'Trade History'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Positions & History */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* ── Positions ── */}
          {activeTab === 'positions' && (
            <div className="space-y-4">
              {!openTrades || openTrades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                  <div className="h-16 w-16 rounded-full bg-gray-900 flex items-center justify-center">
                    <Wallet className="h-8 w-8 text-gray-700" />
                  </div>
                  <div>
                    <h3 className="text-gray-400 font-bold">No open positions</h3>
                    <p className="text-gray-600 text-sm mt-1">Click "Place Trade" or turn on "Auto-Pilot" to start paper trading.</p>
                  </div>
                  <button
                    onClick={() => setShowPlaceOrder(true)}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black text-sm"
                  >
                    <PlusCircle className="h-4 w-4" /> Place First Trade
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {openTrades.map(trade => (
                    <PositionCard key={trade.id} trade={trade} onClose={handleClose} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── History Table ── */}
          {activeTab === 'history' && (
            <Card className="bg-gray-900/60 border-gray-800">
              <CardContent className="pt-0 overflow-auto max-h-[500px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-950/90">
                    <tr className="text-[10px] text-gray-600 font-black uppercase tracking-widest">
                      <th className="text-left py-3 px-4">Stock</th>
                      <th className="text-left py-3 px-2">Type</th>
                      <th className="text-right py-3 px-2">Entry ₹</th>
                      <th className="text-right py-3 px-2">Exit ₹</th>
                      <th className="text-right py-3 px-2">Qty</th>
                      <th className="text-right py-3 px-4">P&L</th>
                      <th className="text-right py-3 px-4">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {!history || history.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-gray-600">No closed trades yet.</td>
                      </tr>
                    ) : history.map(t => (
                      <tr key={t.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-white">{t.symbol.replace('.NS', '')}</td>
                        <td className="py-3 px-2">
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                            t.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>{t.type}</span>
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-gray-300 text-xs">₹{t.entryPrice.toFixed(2)}</td>
                        <td className="py-3 px-2 text-right font-mono text-gray-300 text-xs">₹{(t.exitPrice ?? 0).toFixed(2)}</td>
                        <td className="py-3 px-2 text-right text-gray-500 text-xs">{t.quantity}</td>
                        <td className="py-3 px-4 text-right">
                          <PnlBadge value={t.realPnl ?? 0} />
                        </td>
                        <td className="py-3 px-4 text-right text-[11px] text-gray-600">
                          {t.closedAt ? formatDistanceToNow(new Date(t.closedAt), { addSuffix: true }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

        </div>

        {/* Right Column: Bot Live Logs */}
        <div className="bg-[#0c0c0c] border border-gray-800 rounded-xl flex flex-col h-[600px] overflow-hidden">
          <div className="px-4 py-4 border-b border-gray-800 flex items-center justify-between bg-black/40">
            <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest flex items-center gap-2">
               <TerminalSquare className="h-4 w-4 text-gray-500" />
               Bot Terminal
            </h3>
            <div className="flex items-center gap-2">
               <span className="relative flex h-2 w-2">
                 {botStatus?.isActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                 <span className={`relative inline-flex rounded-full h-2 w-2 ${botStatus?.isActive ? 'bg-emerald-500' : 'bg-gray-600'}`}></span>
               </span>
               <span className={`text-[10px] font-black uppercase tracking-widest ${botStatus?.isActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                 {botStatus?.isActive ? 'Live' : 'Stopped'}
               </span>
            </div>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-2.5 font-mono text-[11px] flex flex-col-reverse">
            {botStatus?.logs && botStatus.logs.length > 0 ? (
              [...botStatus.logs].map(log => (
                <div key={log.id} className={`leading-relaxed break-words ${
                  log.type === 'trade' ? 'text-emerald-400' : log.type === 'alert' ? 'text-yellow-400' : 'text-gray-400'
                }`}>
                  <span className="text-gray-600">[{log.time}]</span> {log.msg}
                </div>
              ))
            ) : (
               <div className="text-gray-600">Connecting to node...</div>
            )}
            <div className="text-gray-600 animate-pulse mt-4">&gt; _</div>
          </div>
        </div>

      </div>

      {/* ── Place Order Modal ── */}
      {showPlaceOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-400" /> Place Manual Trade
              </h2>
              <button onClick={() => setShowPlaceOrder(false)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Same form markup... but condensed for brevity in diffs. Remaining form omitted to avoid duplicate block errors. */}
            
            {/* BUY / SELL toggle */}
            <div className="flex rounded-xl overflow-hidden border border-gray-800">
              {(['BUY', 'SELL'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setOrderForm(f => ({ ...f, type: t }))}
                  className={`flex-1 py-3 text-sm font-black transition-all ${
                    orderForm.type === t
                      ? t === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                      : 'bg-gray-900 text-gray-600 hover:text-white'
                  }`}
                >{t}</button>
              ))}
            </div>

            {/* Stock */}
            <div>
              <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Stock</label>
              <select
                value={orderForm.stockIdx}
                onChange={e => setOrderForm(f => ({ ...f, stockIdx: parseInt(e.target.value) }))}
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
              >
                {NSE_STOCKS.map((s, i) => <option key={s.value} value={i}>{s.label}</option>)}
              </select>
            </div>

            {/* Entry Price & Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Entry Price ₹</label>
                <input
                  type="number"
                  value={orderForm.entryPrice}
                  onChange={e => setOrderForm(f => ({ ...f, entryPrice: e.target.value }))}
                  placeholder="e.g. 1124"
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={orderForm.quantity}
                  onChange={e => setOrderForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Stop Loss & Target */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5 flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-red-400" />Stop Loss %</label>
                <input
                  type="number"
                  value={orderForm.stopLossPct}
                  onChange={e => setOrderForm(f => ({ ...f, stopLossPct: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                />
                {sl > 0 && <div className="text-[10px] text-red-400 mt-1 font-bold">= ₹{sl.toFixed(1)}</div>}
              </div>
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5 flex items-center gap-1"><Target className="h-3 w-3 text-emerald-400" />Target %</label>
                <input
                  type="number"
                  value={orderForm.targetPct}
                  onChange={e => setOrderForm(f => ({ ...f, targetPct: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                />
                {tp > 0 && <div className="text-[10px] text-emerald-400 mt-1 font-bold">= ₹{tp.toFixed(1)}</div>}
              </div>
            </div>

            {/* Reasoning */}
            <div>
              <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Reasoning (optional)</label>
              <input
                type="text"
                value={orderForm.reasoning}
                onChange={e => setOrderForm(f => ({ ...f, reasoning: e.target.value }))}
                placeholder="e.g. RSI oversold + breakout"
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
              />
            </div>

            {/* Summary */}
            {totalCost > 0 && (
              <div className="bg-gray-900 rounded-xl p-3 border border-gray-800 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total cost</span>
                  <span className="font-bold text-white">₹{totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Available cash</span>
                  <span className={`font-bold ${(wallet?.balance ?? 0) >= totalCost ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{(wallet?.balance ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              disabled={!entryPrice || qty < 1 || placeTrade.isPending || (wallet?.balance ?? 0) < totalCost}
              onClick={() => placeTrade.mutate({
                stockId: selectedStock.id,
                symbol: selectedStock.value,
                type: orderForm.type,
                entryPrice,
                quantity: qty,
                stopLoss: sl,
                targetPrice: tp,
                reasoning: orderForm.reasoning || `${orderForm.type} at ₹${entryPrice}`,
                mode: 'MANUAL',
              })}
              className="w-full py-3 rounded-xl font-black text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/20"
            >
              {placeTrade.isPending ? 'Placing...' : `Place ${orderForm.type} Order — ₹${totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Bot Settings Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <Settings className="h-5 w-5 text-gray-500" /> Bot Configuration
              </h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <p className="text-xs text-gray-400 leading-relaxed border-b border-gray-800 pb-4">
              Dynamically tune your risk preferences. The autonomous bot will obey these rules immediately upon saving.
            </p>

            <div className="space-y-4 pt-2">
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Max Allocation per Trade (₹)</label>
                <input
                  type="number"
                  min="1000"
                  value={configForm.allocPerTrade}
                  onChange={e => setConfigForm(f => ({ ...f, allocPerTrade: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3 text-red-400" /> Stop Loss %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={configForm.stopLossPct}
                    onChange={e => setConfigForm(f => ({ ...f, stopLossPct: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-red-500/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                    <Target className="h-3 w-3 text-emerald-400" /> Target %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    value={configForm.targetPct}
                    onChange={e => setConfigForm(f => ({ ...f, targetPct: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
            </div>

            <button
              disabled={updateBotConfig.isPending}
              onClick={() => {
                updateBotConfig.mutate({
                  allocPerTrade: parseFloat(configForm.allocPerTrade) || 10000,
                  stopLossPct: parseFloat(configForm.stopLossPct) || 2.0,
                  targetPct: parseFloat(configForm.targetPct) || 4.0
                })
              }}
              className="w-full py-3 mt-2 rounded-xl font-black text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
            >
              {updateBotConfig.isPending ? 'Saving...' : `Save Configuration`}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
