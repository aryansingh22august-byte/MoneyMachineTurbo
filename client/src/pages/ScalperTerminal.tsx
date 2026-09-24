import { useState, useMemo } from "react";
import { ArrowLeft, Zap, Power, ShieldAlert, TrendingUp, TrendingDown, Layers, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { MarketIndexStrip } from "@/components/MarketIndexStrip";

export default function ScalperTerminal() {
  const [selectedSymbol, setSelectedSymbol] = useState("NSE_INDEX|Nifty 50");

  const { data: rankedStocks } = trpc.stock.getAllStocksRanked.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const { data: botStatus, refetch: refetchBot } = trpc.trading.getBotStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  const { data: optionChain } = trpc.trading.getOptionChain.useQuery(
    { symbol: selectedSymbol },
    { refetchInterval: 10000 }
  );

  const toggleGlobalScreener = trpc.trading.toggleGlobalScreener.useMutation({
    onSuccess: () => refetchBot(),
  });

  const squareOffAll = trpc.trading.squareOffAll.useMutation({
    onSuccess: (data) => {
      toast.success(`All positions squared off. P&L: ₹${data.totalPnl.toFixed(2)}`);
    },
  });

  const isGlobalActive = botStatus?.globalScreenerMode || false;

  const topPicks = useMemo(() => {
    if (!rankedStocks) return [];
    return [...rankedStocks].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 15);
  }, [rankedStocks]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-mono selection:bg-yellow-500/30">
      <MarketIndexStrip />
      
      {/* ── Top Navigation / Control Bar ── */}
      <div className="border-b border-gray-800 bg-[#0a0a0a] px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-2xl">
        <div className="flex items-center gap-4">
          <a href="#dashboard" className="text-gray-500 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </a>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-yellow-500/20 flex items-center justify-center border border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
              <Zap className="h-4 w-4 text-yellow-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white leading-none">PRO ALGO</h1>
              <p className="text-[10px] text-gray-500 tracking-widest uppercase mt-1">High-Frequency Terminal</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Square Off Panic Button */}
          <button
            onClick={() => squareOffAll.mutate()}
            disabled={squareOffAll.isPending}
            className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/40 border border-red-600/50 text-red-400 font-bold px-4 py-2 rounded shadow-[0_0_20px_rgba(220,38,38,0.15)] transition-all active:scale-95 disabled:opacity-50 text-sm"
          >
            <ShieldAlert className="h-4 w-4" />
            SQUARE OFF ALL
          </button>

          {/* Master Auto-Screener Toggle */}
          <button
            onClick={() => toggleGlobalScreener.mutate({ state: !isGlobalActive })}
            className={`flex items-center gap-2 font-bold px-6 py-2 rounded transition-all shadow-lg active:scale-95 text-sm border ${
              isGlobalActive
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.3)] animate-pulse"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
            }`}
          >
            <Power className="h-4 w-4" />
            {isGlobalActive ? "GLOBAL SCREENER: ON" : "GLOBAL SCREENER: OFF"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* ── Left Column: Global Scanner ── */}
        <div className="w-full lg:w-[45%] flex flex-col border-r border-gray-800 bg-[#050505]">
          <div className="p-3 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Activity className="h-3 w-3" />
              Live Breakout Scanner
            </h2>
            <div className="text-[10px] text-gray-600">Tick interval: 3s</div>
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-[#0a0a0a] sticky top-0 border-b border-gray-800 z-10 text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium tracking-wider">Symbol</th>
                  <th className="px-4 py-3 font-medium tracking-wider text-right">Price</th>
                  <th className="px-4 py-3 font-medium tracking-wider text-center">Score</th>
                  <th className="px-4 py-3 font-medium tracking-wider text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {topPicks.map((stock) => {
                  const strength = stock.strength ?? 0;
                  const isHighConviction = strength >= 85;
                  
                  return (
                    <tr 
                      key={stock.id} 
                      onClick={() => setSelectedSymbol(stock.symbol)}
                      className={`hover:bg-gray-800/30 cursor-pointer transition-colors ${
                        selectedSymbol === stock.symbol ? "bg-gray-800/50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-bold text-white flex items-center gap-2">
                        {isHighConviction && <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500 animate-pulse" />}
                        {stock.symbol.replace(".NS", "")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        ₹{stock.lastPrice?.toFixed(2) ?? "0.00"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${strength >= 60 ? 'bg-emerald-500' : strength <= 40 ? 'bg-red-500' : 'bg-yellow-500'}`}
                              style={{ width: `${strength}%` }}
                            />
                          </div>
                          <span className={`font-bold ${isHighConviction ? 'text-emerald-400' : 'text-gray-400'}`}>
                            {strength}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          stock.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          stock.signal === 'SELL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          'bg-gray-800 text-gray-500 border border-gray-700'
                        }`}>
                          {stock.signal}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Right Column: Order Flow & Options Wall ── */}
        <div className="flex-1 flex flex-col bg-black">
          <div className="p-4 border-b border-gray-800 bg-[#0a0a0a] flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">{selectedSymbol.replace(".NS", "").replace("NSE_INDEX|", "")}</h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Options OI Heatmap
                </span>
                {optionChain && (
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    optionChain.pcr > 1.0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                  }`}>
                    PCR: {optionChain.pcr.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 p-6 overflow-y-auto">
            {/* Options Chain Heatmap Table */}
            <div className="bg-[#050505] border border-gray-800 rounded-lg overflow-hidden shadow-2xl">
              <div className="grid grid-cols-3 bg-gray-900 border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-widest text-center">
                <div className="p-3 border-r border-gray-800">Calls (Resistance)</div>
                <div className="p-3 bg-gray-800/50">Strike</div>
                <div className="p-3 border-l border-gray-800">Puts (Support)</div>
              </div>
              
              <div className="divide-y divide-gray-800/30">
                {optionChain?.strikes?.map((row, idx) => {
                  // Normalize OI for visual bars
                  const maxCall = Math.max(...(optionChain.strikes.map(s => s.callOi)));
                  const maxPut = Math.max(...(optionChain.strikes.map(s => s.putOi)));
                  
                  const callPct = (row.callOi / maxCall) * 100;
                  const putPct = (row.putOi / maxPut) * 100;

                  return (
                    <div key={idx} className="grid grid-cols-3 text-sm text-center hover:bg-gray-800/20 transition-colors">
                      {/* Calls */}
                      <div className="p-2 border-r border-gray-800 relative flex items-center justify-end pr-4 group">
                        <div 
                          className="absolute right-0 top-0 bottom-0 bg-red-500/10 transition-all group-hover:bg-red-500/20" 
                          style={{ width: `${callPct}%` }}
                        />
                        <span className="relative z-10 text-gray-300 font-mono text-xs">{row.callOi.toLocaleString()}</span>
                      </div>
                      
                      {/* Strike */}
                      <div className="p-2 bg-gray-900/30 font-bold text-white font-mono flex items-center justify-center">
                        {row.strike.toLocaleString()}
                      </div>
                      
                      {/* Puts */}
                      <div className="p-2 border-l border-gray-800 relative flex items-center justify-start pl-4 group">
                        <div 
                          className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 transition-all group-hover:bg-emerald-500/20" 
                          style={{ width: `${putPct}%` }}
                        />
                        <span className="relative z-10 text-gray-300 font-mono text-xs">{row.putOi.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Execution Matrix */}
            <div className="mt-6 border border-gray-800 rounded-lg p-6 bg-[#050505]">
              <h3 className="text-sm font-bold text-gray-400 mb-4 tracking-widest uppercase">Manual Overrides</h3>
              <div className="grid grid-cols-2 gap-4">
                <button className="flex flex-col items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg p-6 transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.05)]">
                  <TrendingUp className="h-8 w-8" />
                  <span className="font-bold tracking-widest uppercase">Market Buy</span>
                </button>
                <button className="flex flex-col items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg p-6 transition-all active:scale-95 shadow-[0_0_20px_rgba(239,68,68,0.05)]">
                  <TrendingDown className="h-8 w-8" />
                  <span className="font-bold tracking-widest uppercase">Market Sell</span>
                </button>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}
