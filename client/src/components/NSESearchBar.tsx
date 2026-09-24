import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, X, Loader2, Eye } from "lucide-react";
import { NSE_SYMBOLS, NseSymbol } from "@/lib/nseSymbols";
import { trpc } from "@/lib/trpc";
import type { PreviewStock } from "./StockDetailDrawer";

const VALID_STOCK_SYMBOL = /^[A-Z0-9&.\- =^]+$/;

interface Props {
  trackedSymbols: string[]; // symbols already in DB (without .NS)
  onSelectTracked: (symbol: string) => void;  // stock is in DB — open drawer by symbol
  onSelectPreview: (preview: PreviewStock) => void; // stock not in DB — show preview
}

// Defined outside component — stable reference, no useCallback dep needed
function validateSignal(value: unknown): "BUY" | "SELL" | "HOLD" {
  if (value === "BUY" || value === "SELL" || value === "HOLD") return value;
  return "HOLD";
}

export function NSESearchBar({ trackedSymbols, onSelectTracked, onSelectPreview }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [fetchingSymbol, setFetchingSymbol] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // trackedSymbols are already uppercased and .NS-stripped from Dashboard
  const trackedSet = useMemo(() => new Set(trackedSymbols.map((s) => s.toUpperCase())), [trackedSymbols]);

  const filtered: NseSymbol[] = query.trim().length < 1
    ? []
    : NSE_SYMBOLS.filter((s) => {
        const q = query.trim().toUpperCase();
        return s.symbol.startsWith(q) || s.name.toUpperCase().includes(q);
      }).slice(0, 8);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const utils = trpc.useUtils();

  const handleSelect = useCallback(async (sym: NseSymbol) => {
    const bareSymbol = sym.symbol.toUpperCase().trim();
    if (!VALID_STOCK_SYMBOL.test(bareSymbol)) {
      console.warn("[NSESearchBar] Ignoring invalid symbol selection:", bareSymbol);
      return;
    }

    setQuery(bareSymbol);
    setOpen(false);

    if (trackedSet.has(bareSymbol)) {
      onSelectTracked(bareSymbol);
      return;
    }

    // On-demand preview fetch
    setFetchingSymbol(bareSymbol);
    try {
      const data = await utils.stock.getStockQuickPreview.fetch({ symbol: bareSymbol });
      if (data) {
        onSelectPreview({
          symbol: data.symbol,
          lastPrice: data.lastPrice,
          change: data.change,
          percentChange: data.percentChange,
          signal: validateSignal(data.signal),
          strength: data.strength,
          rsi: data.rsi,
          macd: data.macd,
          sma20: data.sma20,
          sma50: data.sma50,
          predictedPrice: data.predictedPrice,
          technicalScore: data.technicalScore,
          sentimentScore: data.sentimentScore,
          isPreview: true,
        });
      }
    } catch (err) {
      console.error("[NSESearchBar] Preview fetch failed:", err);
    } finally {
      setFetchingSymbol(null);
    }
  }, [trackedSet, onSelectTracked, onSelectPreview, utils]);

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          placeholder="Search any NSE stock... (e.g. RELIANCE, HDFC Bank)"
          className="w-full bg-gray-800/80 border border-gray-700 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
        />
        {fetchingSymbol ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-400 animate-spin" />
        ) : query ? (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {filtered.map((sym) => {
            const isTracked = trackedSet.has(sym.symbol.toUpperCase());
            return (
              <button
                key={sym.symbol}
                onClick={() => handleSelect(sym)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center text-xs font-bold text-white group-hover:bg-indigo-700/50 transition-colors">
                    {sym.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{sym.symbol}</div>
                    <div className="text-xs text-gray-400 truncate max-w-48">{sym.name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{sym.sector}</span>
                  {isTracked ? (
                    <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded">Tracked</span>
                  ) : (
                    <span className="text-xs text-gray-500 flex items-center gap-1"><Eye className="h-3 w-3" />Preview</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && query.trim().length >= 1 && filtered.length === 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-4 text-center text-sm text-gray-500">
          No NSE stocks found for "{query}"
        </div>
      )}
    </div>
  );
}
