import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { NSESearchBar } from "@/components/NSESearchBar";
import { StockDetailDrawer, PreviewStock } from "@/components/StockDetailDrawer";
import { PredictionBreakdownPopup } from "@/components/PredictionBreakdownPopup";
import { UpstoxStatusButton } from "@/components/UpstoxStatusButton";
import { AlertBellButton } from "@/components/AlertBellButton";
import { useLivePriceUpdates } from "@/hooks/useRealtimeUpdates";
import { TrendingUp, TrendingDown, RefreshCw, Search, Activity, BarChart2, Bot, Zap, Filter } from "lucide-react";
import { Link } from "wouter";
import { MarketIndexStrip } from "@/components/MarketIndexStrip";

// ── Types ──────────────────────────────────────────────────────────────────
type Signal = "BUY" | "SELL" | "HOLD";
type SortKey = "confidence" | "change" | "rsi";
type FilterTab = "ALL" | "BUY" | "SELL" | "HOLD" | string; // string for sector filter

interface RankedStock {
  id: number;
  symbol: string;
  companyName: string;
  sector: string;
  lastPrice: number | null;
  change: number | null;
  percentChange: number | null;
  signal: Signal;
  strength: number;
  rsi: number | null;
  macd: number | null;
  technicalScore: number | null;
  sentimentScore: number | null;
  predictedPrice: number | null;
  accuracy: number | null;
  totalPredictions: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const SIGNAL_STYLES: Record<Signal, { badge: string; glow: string; dot: string }> = {
  BUY:  { badge: "bg-green-500/20 text-green-400 border border-green-500/40",  glow: "hover:shadow-green-500/10",  dot: "bg-green-400" },
  SELL: { badge: "bg-red-500/20 text-red-400 border border-red-500/40",        glow: "hover:shadow-red-500/10",    dot: "bg-red-400" },
  HOLD: { badge: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40", glow: "hover:shadow-yellow-500/10", dot: "bg-yellow-400" },
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function SectorBadge({ sector }: { sector: string }) {
  const colors: Record<string, string> = {
    IT: "bg-blue-500/10 text-blue-400",
    "Financial Services": "bg-purple-500/10 text-purple-400",
    Energy: "bg-orange-500/10 text-orange-400",
    Pharma: "bg-pink-500/10 text-pink-400",
    Automobile: "bg-cyan-500/10 text-cyan-400",
    FMCG: "bg-lime-500/10 text-lime-400",
    Metals: "bg-zinc-400/10 text-zinc-400",
    Cement: "bg-stone-400/10 text-stone-400",
    Infrastructure: "bg-amber-500/10 text-amber-400",
    Consumer: "bg-rose-500/10 text-rose-400",
    Chemicals: "bg-teal-500/10 text-teal-400",
    Telecom: "bg-sky-500/10 text-sky-400",
    Defense: "bg-indigo-500/10 text-indigo-400",
    Logistics: "bg-violet-500/10 text-violet-400",
    "Real Estate": "bg-emerald-500/10 text-emerald-400",
    Diversified: "bg-gray-500/10 text-gray-400",
    Commodities: "bg-yellow-600/10 text-yellow-500",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[sector] ?? "bg-gray-700 text-gray-400"}`}>
      {sector}
    </span>
  );
}


// ── AI Copilot Feed Component ──────────────────────────────────────────────
function CopilotFeed() {
  const { data: botStatus } = trpc.trading.getBotStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const logs = botStatus?.logs || [];

  return (
    <div className="w-[320px] border-l border-gray-800 bg-black hidden xl:flex flex-col h-screen sticky top-0 shrink-0">
      <div className="p-4 border-b border-gray-800 flex items-center gap-2 bg-gray-900/50 backdrop-blur-md z-10">
        <Bot className="h-5 w-5 text-indigo-400" />
        <h3 className="font-bold text-white text-sm">AI Copilot</h3>
        <span className="ml-auto text-[10px] uppercase font-bold tracking-widest text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full">Live</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
        {logs.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-10 flex flex-col items-center">
            <Activity className="h-8 w-8 mb-2 opacity-20" />
            Standing by...
          </div>
        ) : (
          [...logs].reverse().map((log) => (
            <div key={log.id} className="flex gap-2 animate-in slide-in-from-right-2 fade-in duration-300">
              <div className="mt-1">
                {log.type === "alert" ? (
                  <div className="h-7 w-7 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center text-[11px] shadow-[0_0_10px_rgba(239,68,68,0.2)]">⚠️</div>
                ) : log.type === "trade" ? (
                  <div className="h-7 w-7 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 flex items-center justify-center text-[11px] shadow-[0_0_10px_rgba(34,197,94,0.2)]">⚡</div>
                ) : (
                  <div className="h-7 w-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center text-[11px] shadow-[0_0_10px_rgba(99,102,241,0.2)]">🤖</div>
                )}
              </div>
              <div className="flex-1">
                <div className="bg-gray-800/80 border border-gray-700/50 rounded-2xl rounded-tl-sm p-3 text-xs text-gray-300 leading-relaxed shadow-sm">
                  {log.msg}
                </div>
                <div className="text-[10px] text-gray-500 font-medium mt-1.5 ml-1">{log.time}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Stock Card with Live Flash ─────────────────────────────────────────────
function StockCard({
  stock,
  rank,
  onClick,
  flashDirection,
}: {
  stock: RankedStock;
  rank: number;
  onClick: () => void;
  flashDirection?: 'up' | 'down' | null;
}) {
  const styles = SIGNAL_STYLES[stock.signal];
  const pct = stock.percentChange ?? 0;
  const isUp = pct > 0;
  const isDown = pct < 0;
  const isNeutral = pct === 0;

  // Flash animation state — triggers briefly when price updates
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (flashDirection) {
      setFlash(flashDirection);
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 800);
    }
    return () => { if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current); };
  }, [flashDirection]);

  const flashClass =
    flash === 'up'   ? 'ring-2 ring-green-400/60 shadow-[0_0_20px_rgba(34,197,94,0.3)]' :
    flash === 'down' ? 'ring-2 ring-red-400/60 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : '';

  return (
    <div
      onClick={onClick}
      className={`bg-gray-900/60 border border-gray-800 rounded-xl p-4 cursor-pointer hover:border-gray-600 hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 ${styles.glow} group ${flashClass}`}
    >
      {/* Row 1: Rank + Symbol + Price */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-mono w-5">#{rank}</span>
          <div>
            <div className="font-bold text-white text-sm">{stock.symbol.replace(".NS", "")}</div>
            <div className="text-xs text-gray-500 truncate max-w-32">{stock.companyName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold transition-colors duration-300 ${flash === 'up' ? 'text-green-300' : flash === 'down' ? 'text-red-300' : 'text-white'}`}>
            {stock.lastPrice != null ? `₹${stock.lastPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}
          </div>
          <div className={`flex items-center justify-end gap-0.5 text-xs font-semibold ${isUp ? "text-green-400" : isDown ? "text-red-400" : "text-gray-500"}`}>
            {isUp && <TrendingUp className="h-3 w-3" />}
            {isDown && <TrendingDown className="h-3 w-3" />}
            {isUp ? "+" : ""}{isNeutral ? "0" : fmt(pct)}%
          </div>
        </div>
      </div>

      {/* Row 2: Sector + Signal badge */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectorBadge sector={stock.sector} />
        <PredictionBreakdownPopup
          prediction={{
            signal: stock.signal,
            strength: stock.strength,
            rsi: stock.rsi,
            macd: stock.macd,
            technicalScore: stock.technicalScore,
            sentimentScore: stock.sentimentScore,
          }}
        >
          <span
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer hover:opacity-80 transition-all duration-300 ${styles.badge}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${styles.dot} ${flash ? 'animate-ping' : ''}`} />
            {stock.signal}
          </span>
        </PredictionBreakdownPopup>

        {/* Predicted price badge */}
        {stock.predictedPrice != null && stock.lastPrice != null && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            stock.predictedPrice > stock.lastPrice
              ? 'bg-green-500/10 text-green-400/80'
              : 'bg-red-500/10 text-red-400/80'
          }`}>
            Target: ₹{fmt(stock.predictedPrice, 0)}
          </span>
        )}
      </div>

      {/* Row 3: Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="text-gray-500 mb-0.5">Confidence</div>
          <div className="font-bold text-white">{stock.strength}%</div>
          <div className="h-1 bg-gray-800 rounded-full mt-1 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${stock.signal === "BUY" ? "bg-green-500" : stock.signal === "SELL" ? "bg-red-500" : "bg-yellow-500"}`}
              style={{ width: `${stock.strength}%` }}
            />
          </div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 mb-0.5">RSI</div>
          <div className={`font-bold ${stock.rsi != null && stock.rsi < 30 ? "text-green-400" : stock.rsi != null && stock.rsi > 70 ? "text-red-400" : "text-white"}`}>
            {fmt(stock.rsi, 1)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 mb-0.5">Accuracy</div>
          <div className="font-bold text-white">
            {stock.accuracy != null ? `${(stock.accuracy * 100).toFixed(0)}%` : <span className="text-gray-600 text-xs">Building...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [previewStock, setPreviewStock] = useState<PreviewStock | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sectorMenuOpen, setSectorMenuOpen] = useState(false);
  const sectorMenuRef = useRef<HTMLDivElement>(null);

  // Live price updates via SSE
  const { prices: livePrices, lastFlash } = useLivePriceUpdates();

  // Close sector dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (sectorMenuRef.current && !sectorMenuRef.current.contains(e.target as Node)) {
        setSectorMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const { data: rankedStocks, isLoading, refetch } = trpc.stock.getAllStocksRanked.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const { data: allStocks } = trpc.stock.getAllStocks.useQuery();

  const trackedSymbols = useMemo(
    () => allStocks?.map((s) => s.symbol.replace(".NS", "").toUpperCase()) ?? [],
    [allStocks]
  );

  const sectors = useMemo(() => {
    if (!rankedStocks) return [];
    return [...new Set(rankedStocks.map((s) => s.sector).filter(Boolean))].sort();
  }, [rankedStocks]);

  // Merge ranked stocks with live price updates
  const enrichedStocks = useMemo(() => {
    if (!rankedStocks) return [];
    return rankedStocks.map((stock) => {
      const live = livePrices.get(stock.id);
      if (!live) return stock as RankedStock;
      return {
        ...stock,
        lastPrice: live.lastPrice ?? stock.lastPrice,
        change: live.change ?? stock.change,
        percentChange: live.percentChange ?? stock.percentChange,
        signal: (live.signal ?? stock.signal) as Signal,
        strength: live.strength ?? stock.strength,
      } as RankedStock;
    });
  }, [rankedStocks, livePrices]);

  const filtered = useMemo(() => {
    if (!enrichedStocks) return [];
    let list = [...enrichedStocks];

    if (filterTab === "BUY" || filterTab === "SELL" || filterTab === "HOLD") {
      list = list.filter((s) => s.signal === filterTab);
    } else if (filterTab !== "ALL") {
      list = list.filter((s) => s.sector === filterTab);
    }

    if (sortKey === "change") {
      list.sort((a, b) => (b.percentChange ?? 0) - (a.percentChange ?? 0));
    } else if (sortKey === "rsi") {
      list.sort((a, b) => (a.rsi ?? 50) - (b.rsi ?? 50));
    }

    return list;
  }, [enrichedStocks, filterTab, sortKey]);

  // Stats summary
  const stats = useMemo(() => {
    if (!enrichedStocks) return { buy: 0, sell: 0, hold: 0, avgSentiment: 0, liveCount: 0 };
    const buy = enrichedStocks.filter((s) => s.signal === "BUY").length;
    const sell = enrichedStocks.filter((s) => s.signal === "SELL").length;
    const hold = enrichedStocks.filter((s) => s.signal === "HOLD").length;
    const avgSentiment = enrichedStocks.length > 0
      ? Math.round(enrichedStocks.reduce((sum, s) => sum + (s.sentimentScore ?? 50), 0) / enrichedStocks.length)
      : 0;
    return { buy, sell, hold, avgSentiment, liveCount: livePrices.size };
  }, [enrichedStocks, livePrices]);

  const handleSelectSymbol = (symbol: string) => {
    const stock = allStocks?.find((s) => s.symbol.replace(".NS", "").toUpperCase() === symbol.toUpperCase());
    if (stock) {
      setPreviewStock(null);
      setSelectedStockId(stock.id);
    }
  };

  const handleCloseDrawer = () => {
    setSelectedStockId(null);
    setPreviewStock(null);
  };

  const filterTabs: Array<{ key: FilterTab; label: string; count?: number }> = [
    { key: "ALL", label: "All", count: enrichedStocks?.length },
    { key: "BUY", label: "BUY", count: stats.buy },
    { key: "SELL", label: "SELL", count: stats.sell },
    { key: "HOLD", label: "HOLD", count: stats.hold },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col xl:flex-row">
      {/* ── Main Content Area ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative pb-20 overflow-x-hidden">
        <MarketIndexStrip />
        <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6 w-full flex-grow">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <BarChart2 className="h-7 w-7 text-indigo-400" />
              Market Scanner
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {enrichedStocks?.length ?? 0} NSE stocks · AI-powered signals · Real-time
              {stats.liveCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  {stats.liveCount} live
                </span>
              )}
            </p>
          </div>
            <div className="flex items-center gap-3 self-start sm:self-auto">
              {/* Upstox live-feed connection status + one-click reconnect */}
              <UpstoxStatusButton />
              
              {/* Alert Bell */}
              <AlertBellButton />

              <button
                onClick={() => refetch()}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-2 hover:border-gray-500 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <a href="#scalper" className="flex items-center gap-2 text-sm text-yellow-400 font-bold bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 rounded-lg px-3 py-2 transition-colors">
              <Zap className="h-4 w-4 fill-yellow-400" />
              Pro Algo
            </a>
          </div>
        </div>

        {/* ── NSE Search Bar ───────────────────────────────────────────── */}
        <NSESearchBar
          trackedSymbols={trackedSymbols}
          onSelectTracked={handleSelectSymbol}
          onSelectPreview={(preview) => {
            setSelectedStockId(null);
            setPreviewStock(preview);
          }}
        />

        {/* ── Summary Stats ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{stats.buy}</div>
            <div className="text-xs text-gray-400 mt-1">BUY Signals</div>
          </div>
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.sell}</div>
            <div className="text-xs text-gray-400 mt-1">SELL Signals</div>
          </div>
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.hold}</div>
            <div className="text-xs text-gray-400 mt-1">HOLD Signals</div>
          </div>
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-indigo-400">{stats.avgSentiment}</div>
            <div className="text-xs text-gray-400 mt-1">Avg Sentiment</div>
          </div>
        </div>

        {/* ── Filter Tabs + Sort ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-xl p-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterTab === tab.key
                    ? tab.key === "BUY" ? "bg-green-500/20 text-green-400"
                    : tab.key === "SELL" ? "bg-red-500/20 text-red-400"
                    : tab.key === "HOLD" ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Sector dropdown */}
          <div className="relative" ref={sectorMenuRef}>
            <button
              onClick={() => setSectorMenuOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm border transition-colors ${
                !["ALL", "BUY", "SELL", "HOLD"].includes(filterTab)
                  ? "bg-indigo-600 text-white border-indigo-500"
                  : "bg-gray-800/60 text-gray-400 border-gray-700 hover:text-white"
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              {!["ALL", "BUY", "SELL", "HOLD"].includes(filterTab) ? filterTab : "By Sector"}
            </button>
            {sectorMenuOpen && (
              <div className="absolute top-full mt-1 left-0 z-40 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 min-w-40 max-h-64 overflow-y-auto">
                <button
                  onClick={() => { setFilterTab("ALL"); setSectorMenuOpen(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800"
                >
                  All Sectors
                </button>
                {sectors.map((sector) => (
                  <button
                    key={sector}
                    onClick={() => { setFilterTab(sector); setSectorMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800"
                  >
                    {sector}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-xl p-1 ml-auto">
            <span className="text-xs text-gray-500 px-2">Sort:</span>
            {([["confidence", "Confidence"], ["change", "Change%"], ["rsi", "RSI"]] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sortKey === key ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stock Grid ───────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 animate-pulse">
                <div className="flex justify-between mb-3">
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-700 rounded w-16" />
                    <div className="h-3 bg-gray-800 rounded w-28" />
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-4 bg-gray-700 rounded w-20" />
                    <div className="h-3 bg-gray-800 rounded w-14" />
                  </div>
                </div>
                <div className="flex gap-2 mb-3">
                  <div className="h-5 bg-gray-800 rounded-full w-16" />
                  <div className="h-5 bg-gray-800 rounded-full w-12" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((j) => <div key={j} className="h-8 bg-gray-800 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        ) : enrichedStocks?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Activity className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">Syncing market data...</p>
            <p className="text-sm mt-1 text-gray-600">First sync runs on startup — stocks will appear shortly.</p>
            <button onClick={() => refetch()} className="mt-4 text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full">
              Refresh
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Activity className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg">No stocks match this filter</p>
            <button onClick={() => setFilterTab("ALL")} className="mt-3 text-sm text-indigo-400 hover:text-indigo-300">
              Clear filter
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((stock, idx) => (
              <StockCard
                key={stock.id}
                stock={stock as RankedStock}
                rank={idx + 1}
                flashDirection={
                  lastFlash && lastFlash.stockId === stock.id && Date.now() - lastFlash.ts < 1000
                    ? (lastFlash.direction === "neutral" ? null : lastFlash.direction)
                    : null
                }
                onClick={() => {
                  setPreviewStock(null);
                  setSelectedStockId(stock.id);
                }}
              />
            ))}
          </div>
        )}
        </div>
      </div>

      {/* ── AI Copilot Feed (Right Sidebar) ─────────────────────────────── */}
      <CopilotFeed />

      {/* ── Stock Detail Drawer ──────────────────────────────────────────── */}
      <StockDetailDrawer
        stockId={selectedStockId}
        previewStock={previewStock}
        onClose={handleCloseDrawer}
        onSelectRelated={(id) => {
          setPreviewStock(null);
          setSelectedStockId(id);
        }}
      />
    </div>
  );
}
