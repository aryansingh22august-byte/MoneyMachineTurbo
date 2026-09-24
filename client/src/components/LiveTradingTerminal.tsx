import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Activity, Briefcase, History, RefreshCw, Zap, TrendingUp, TrendingDown, Target, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function LiveTradingTerminal() {
  const [activeTab, setActiveTab] = useState<'positions' | 'history'>('positions');
  const [isAiMode, setIsAiMode] = useState(true);

  const { data: wallet, refetch: refetchWallet } = trpc.trading.getWallet.useQuery(undefined, { refetchInterval: 5000 });
  const { data: openTrades, refetch: refetchTrades } = trpc.trading.getActiveTrades.useQuery(undefined, { refetchInterval: 2000 });
  const { data: tradeHistory } = trpc.trading.getTradeHistory.useQuery({ limit: 50 }, { refetchInterval: 10000 });

  const totalPnl = (wallet?.totalGained || 0) + (wallet?.totalLost || 0);
  const isProfitable = totalPnl >= 0;

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #09090b 0%, #111827 100%)' }}>
      
      {/* ── Header & Wallet ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Zap className="h-8 w-8 text-yellow-400" />
            <h1 className="text-3xl font-black text-white">Aggressive Execution Bot</h1>
            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Virtual Paper Trading
            </span>
          </div>
          <p className="text-white/40 text-sm max-w-xl">
            High-velocity automated trading based on Swarm Intelligence &gt;65% confidence. 
            All trades simulate realistic 0.05% order slippage.
          </p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 flex items-center gap-8 min-w-[320px]">
          <div>
            <div className="text-xs text-white/40 font-semibold mb-1">CURRENT BALANCE</div>
            <div className="text-3xl font-black text-white font-mono">
              ₹{wallet?.balance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '1,000.00'}
            </div>
          </div>
          <div className="w-px h-12 bg-gray-800"></div>
          <div>
            <div className="text-xs text-white/40 font-semibold mb-1">NET P&L</div>
            <div className={`text-xl font-bold font-mono ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}₹{totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Control Panel ── */}
      <div className="flex items-center justify-between bg-gray-900/40 border border-gray-800 rounded-xl p-2 pb-2 pl-4 pr-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white/60">Bot Mode:</span>
            <button 
              onClick={() => setIsAiMode(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isAiMode ? 'bg-indigo-600 text-white shadow-[0_0_10px_rgba(79,70,229,0.3)]' : 'bg-gray-800 text-white/40 hover:text-white'}`}
            >
              Swarm AI Targets
            </button>
            <button 
              onClick={() => setIsAiMode(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!isAiMode ? 'bg-zinc-700 text-white shadow-[0_0_10px_rgba(63,63,70,0.5)]' : 'bg-gray-800 text-white/40 hover:text-white'}`}
            >
              Fixed 2% Targets
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
           <button onClick={() => { refetchWallet(); refetchTrades(); }} className="p-2 text-white/40 hover:text-white bg-gray-800 rounded-lg transition-colors">
              <RefreshCw className="h-4 w-4" />
           </button>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Positions & History */}
        <div className="lg:col-span-2 space-y-4">
          
          <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
            <button 
              onClick={() => setActiveTab('positions')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'positions' ? 'border-indigo-500 text-white' : 'border-transparent text-white/40 hover:text-white/80'}`}
            >
              <Activity className="h-4 w-4" /> Open Positions ({openTrades?.length || 0})
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'history' ? 'border-indigo-500 text-white' : 'border-transparent text-white/40 hover:text-white/80'}`}
            >
              <History className="h-4 w-4" /> Trading History
            </button>
          </div>

          {activeTab === 'positions' && (
            <div className="space-y-3">
              {openTrades?.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-gray-800 rounded-xl">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-900 mb-3">
                    <Briefcase className="h-5 w-5 text-gray-600" />
                  </div>
                  <h3 className="text-sm font-bold text-white/60">No Open Positions</h3>
                  <p className="text-xs text-white/30 mt-1">Bot is waiting for high conviction Swarm signals...</p>
                </div>
              ) : (
                openTrades?.map(trade => (
                  <div key={trade.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`h-12 w-12 rounded-full flex items-center justify-center ${trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {trade.type === 'BUY' ? <TrendingUp /> : <TrendingDown />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg text-white">{trade.symbol}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${trade.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{trade.type}</span>
                        </div>
                        <div className="text-xs text-white/40 mt-0.5">
                          {trade.quantity} shares @ ₹{trade.entryPrice.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-white/30 mt-1 italic">
                          "{trade.reasoning}"
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-[10px] text-white/40 font-bold mb-1 flex items-center gap-1 justify-end">
                           <Target className="h-3 w-3 text-emerald-400" /> Target
                        </div>
                        <div className="text-sm font-mono text-emerald-400">₹{trade.targetPrice.toFixed(2)}</div>
                      </div>
                      <div className="w-px h-8 bg-gray-800"></div>
                      <div className="text-right">
                        <div className="text-[10px] text-white/40 font-bold mb-1 flex items-center gap-1 justify-end">
                           <ShieldAlert className="h-3 w-3 text-red-400" /> Stop Loss
                        </div>
                        <div className="text-sm font-mono text-red-400">₹{trade.stopLoss.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-2">
              <div className="grid grid-cols-6 text-xs font-bold text-white/40 px-4 mb-2">
                <div className="col-span-2">Symbol</div>
                <div className="text-right">Entry</div>
                <div className="text-right">Exit</div>
                <div className="text-center">Time</div>
                <div className="text-right">P&L</div>
              </div>
              
              {tradeHistory?.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/30">No history yet.</div>
              ) : (
                tradeHistory?.map(trade => (
                  <div key={trade.id} className="grid grid-cols-6 items-center text-sm px-4 py-3 bg-gray-900/40 hover:bg-gray-800/60 rounded-lg transition-colors border border-gray-800/50">
                    <div className="col-span-2 font-bold text-white flex items-center gap-2">
                       <span className={`h-2 w-2 rounded-full ${trade.type === 'BUY' ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                       {trade.symbol}
                    </div>
                    <div className="text-right font-mono text-white/70">₹{trade.entryPrice.toFixed(2)}</div>
                    <div className="text-right font-mono text-white/70">₹{(trade.exitPrice || 0).toFixed(2)}</div>
                    <div className="text-center text-xs text-white/40">
                      {trade.closedAt ? formatDistanceToNow(new Date(trade.closedAt), { addSuffix: true }) : ''}
                    </div>
                    <div className={`text-right font-mono font-bold ${trade.realPnl && trade.realPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.realPnl && trade.realPnl > 0 ? '+' : ''}₹{(trade.realPnl || 0).toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>

        {/* Right Column: Bot Live Logs */}
        <div className="bg-[#0c0c0c] border border-gray-800 rounded-xl flex flex-col h-[500px] overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-black/40">
            <h3 className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-2">
               <span className="relative flex h-2 w-2">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
               </span>
               Bot Terminal
            </h3>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-3 font-mono text-[11px] text-emerald-400/80">
            <div>&gt; System initialized...</div>
            <div>&gt; Loaded paper wallet: ₹{wallet?.balance?.toFixed(2)}</div>
            <div>&gt; Swarm Intelligence link: [CONNECTED]</div>
            <div>&gt; Listening for live market ticks...</div>
            {openTrades?.map(t => (
              <div key={`log-${t.id}`} className="text-white/60">
                &gt; MONITORING: {t.symbol} [SL: {t.stopLoss.toFixed(1)} | TP: {t.targetPrice.toFixed(1)}]
              </div>
            ))}
            <div className="animate-pulse">&gt; _</div>
          </div>
        </div>

      </div>
    </div>
  );
}
