import { useState, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp, ExternalLink, GitBranch, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PredictionBreakdownPopup, getRsiScore, getMacdScore, getSmaTrendScore } from "./PredictionBreakdownPopup";

interface StockDetailDrawerProps {
  stockId: number | null;
  previewStock?: PreviewStock | null;
  onClose: () => void;
  onSelectRelated: (id: number) => void;
}

export interface PreviewStock {
  symbol: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  rsi: number;
  macd: number;
  sma20: number;
  sma50: number;
  predictedPrice: number;
  technicalScore: number;
  sentimentScore: number;
  isPreview: true;
}

function SignalBadge({ signal, strength, prediction }: { signal: "BUY" | "SELL" | "HOLD"; strength: number; prediction: any }) {
  const colors = {
    BUY: "bg-green-500/20 text-green-400 border border-green-500/40",
    SELL: "bg-red-500/20 text-red-400 border border-red-500/40",
    HOLD: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  };
  return (
    <PredictionBreakdownPopup prediction={{ signal, strength, ...prediction }}>
      <button className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold cursor-pointer hover:opacity-80 transition-opacity ${colors[signal]}`}>
        {signal}
        <span className="text-xs opacity-80">{strength}%</span>
      </button>
    </PredictionBreakdownPopup>
  );
}

function IndicatorCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-3 text-center">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-white font-bold text-sm">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownBar({ label, value, maxValue, color, noData = false }: { label: string; value: number; maxValue: number; color: string; noData?: boolean }) {
  const pct = noData ? 0 : Math.max(0, Math.min(100, (value / maxValue) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={`font-mono ${noData ? "text-gray-600" : "text-white"}`}>{noData ? "—" : `${Math.round(pct)}%`}</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${noData ? "bg-gray-700" : color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Builds chart data: historical prices + interpolated predicted trajectory
function buildChartData(history: Array<{ timestamp?: string | null; lastPrice?: number | null }>, predictedPrice: number) {
  const filtered = history
    .filter((h) => h.lastPrice != null)
    .slice(-30)
    .map((h) => ({
      label: h.timestamp ? new Date(h.timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : "",
      price: h.lastPrice as number,
      predicted: undefined as number | undefined,
    }));

  if (filtered.length === 0) return [];

  const lastPrice = filtered[filtered.length - 1].price;
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const interpPrice = lastPrice + ((predictedPrice - lastPrice) * i) / steps;
    filtered.push({
      label: `T+${i}`,
      price: undefined as any,
      predicted: parseFloat(interpPrice.toFixed(2)),
    });
  }
  // Anchor the prediction start at the last real point
  filtered[filtered.length - steps - 1].predicted = lastPrice;

  return filtered;
}

// Custom animated predicted line dot
function PulseDot(props: any) {
  const { cx, cy, index, data } = props;
  if (!data?.[index]?.predicted || data?.[index]?.price != null) return null;
  return (
    <circle cx={cx} cy={cy} r={4} fill="#f59e0b" stroke="#fbbf24" strokeWidth={2}>
      <animate attributeName="r" values="3;6;3" dur="1.5s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
  );
}

export function StockDetailDrawer({ stockId, previewStock, onClose, onSelectRelated }: StockDetailDrawerProps) {
  const isOpen = stockId != null || previewStock != null;
  const [newsExpanded, setNewsExpanded] = useState(false);
  const [fibAlert, setFibAlert] = useState<any>(null);
  const prevStockId = useRef<number | null>(null);

  // Reset newsExpanded when the user switches to a different stock
  useEffect(() => {
    if (stockId !== prevStockId.current) {
      setNewsExpanded(false);
      prevStockId.current = stockId;
    }
  }, [stockId]);

  const { data: latestPrice, refetch: refetchPrice } = trpc.stock.getLatestPrice.useQuery(
    { stockId: stockId ?? 0 },
    { enabled: stockId !== null }
  );

  const { data: prediction, refetch: refetchPrediction } = trpc.stock.getLatestPrediction.useQuery(
    { stockId: stockId ?? 0 },
    { enabled: stockId !== null }
  );

  const { data: history, refetch: refetchHistory } = trpc.stock.getPriceHistory.useQuery(
    { stockId: stockId ?? 0, days: 30 },
    { enabled: stockId !== null }
  );

  const { data: technicals, refetch: refetchTechnicals } = trpc.stock.getTechnicalIndicators.useQuery(
    { stockId: stockId ?? 0 },
    { enabled: stockId !== null }
  );

  const { data: related } = trpc.stock.getRelatedStocks.useQuery(
    { stockId: stockId ?? 0, limit: 6 },
    { enabled: stockId !== null }
  );

  const { data: news } = trpc.stock.getNewsSentiment.useQuery(
    { stockId: stockId ?? 0, limit: 5 },
    { enabled: stockId !== null }
  );

  const { data: accuracy } = trpc.stock.getAccuracyMetrics.useQuery(
    { stockId: stockId ?? 0 },
    { enabled: stockId !== null }
  );

  // Fibonacci analysis — fetched for full drawer (not preview mode)
  // We capture symbol from previewStock (available immediately) or defer to
  // displayPrice which becomes available after DB query resolves.
  const [fibSymbol, setFibSymbol] = useState<string>(previewStock?.symbol ?? '');
  const { data: fibAnalysisData } = trpc.fibonacci.getFibAnalysis.useQuery(
    { symbol: fibSymbol.includes('.') ? fibSymbol : `${fibSymbol}.NS` },
    { enabled: fibSymbol.length > 0, staleTime: 5 * 60_000 }
  );


  // Live SSE updates — price header uses SSE for speed; chart/technicals refetch from DB on each SSE tick
  const [livePrice, setLivePrice] = useState<any>(null);
  const [livePrediction, setLivePrediction] = useState<any>(null);

  useEffect(() => {
    if (!stockId) {
      setLivePrice(null);
      setLivePrediction(null);
      setFibAlert(null);
      return;
    }

    let mounted = true;
    const source = new EventSource("/api/live/subscribe");

    source.addEventListener("liveUpdate", (e: MessageEvent) => {
      if (!mounted) return;
      try {
        const payload = JSON.parse(e.data);
        if (payload.stockId !== stockId) return;
        setLivePrice(payload);
        setLivePrediction(payload);
        void refetchHistory();
        void refetchTechnicals();
        void refetchPrediction();
        void refetchPrice();
      } catch (err) {
        console.error("[StockDetailDrawer] Failed to parse liveUpdate:", err);
      }
    });

    // ── Fibonacci alert SSE listener ──
    source.addEventListener("fibAlert", (e: MessageEvent) => {
      if (!mounted) return;
      try {
        const payload = JSON.parse(e.data);
        if (payload.stockId !== stockId) return;
        setFibAlert(payload);
        // Auto-clear APPROACHING alerts after 30s; keep TRIGGERED until dismissed
        if (payload.alertTier === 'APPROACHING') {
          setTimeout(() => setFibAlert(null), 30_000);
        }
      } catch { /* ignore */ }
    });

    source.onerror = () => {
      if (!mounted) return;
      setLivePrice(null);
      setLivePrediction(null);
      source.close();
    };

    return () => {
      mounted = false;
      source.close();
    };
  }, [stockId]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayPrice = previewStock ?? livePrice ?? latestPrice;
  const displayPrediction = previewStock ?? livePrediction ?? prediction;

  // Update fibSymbol once displayPrice is available (covers DB-loaded stocks)
  useEffect(() => {
    const sym = (displayPrice as any)?.symbol ?? previewStock?.symbol ?? '';
    if (sym && sym !== fibSymbol) setFibSymbol(sym);
  }, [(displayPrice as any)?.symbol, previewStock?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const predictedPrice = displayPrediction?.predictedPrice ?? displayPrice?.lastPrice ?? 0;
  const chartData = buildChartData(history ?? [], predictedPrice);

  const priceChange = displayPrice?.change ?? 0;
  const pctChange = displayPrice?.percentChange ?? 0;
  const isUp = priceChange >= 0;

  const signalColors = {
    BUY: "bg-green-500/10 border-green-500/30 text-green-400",
    SELL: "bg-red-500/10 border-red-500/30 text-red-400",
    HOLD: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400",
  };
  const signal: "BUY" | "SELL" | "HOLD" = displayPrediction?.signal ?? "HOLD";

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-gray-950 border-gray-800 text-white p-0 overflow-hidden"
      >
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <SheetHeader className="space-y-0">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-mono">NSE</span>
                    {previewStock && (
                      <span className="text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded">Preview Mode</span>
                    )}
                  </div>
                  <SheetTitle className="text-2xl font-bold text-white">
                    {previewStock?.symbol.replace(".NS", "") ?? displayPrice?.symbol ?? `Stock #${stockId}`}
                  </SheetTitle>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-white">
                    ₹{typeof displayPrice?.lastPrice === "number" ? displayPrice.lastPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                  </div>
                  <div className={`flex items-center justify-end gap-1 text-sm font-semibold ${isUp ? "text-green-400" : "text-red-400"}`}>
                    {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {isUp ? "+" : ""}{typeof priceChange === "number" ? priceChange.toFixed(2) : "0.00"}
                    <span>({isUp ? "+" : ""}{typeof pctChange === "number" ? pctChange.toFixed(2) : "0.00"}%)</span>
                  </div>
                </div>
              </div>

              {/* Signal + Accuracy Row */}
              <div className="flex items-center gap-3 pt-2">
                {displayPrediction && (
                  <SignalBadge
                    signal={signal}
                    strength={displayPrediction.strength ?? 0}
                    prediction={displayPrediction}
                  />
                )}
                {accuracy && accuracy.totalPredictions >= 5 && (
                  <span className="text-xs text-gray-400">
                    Model accuracy: <span className="text-white font-semibold">{(accuracy.accuracy * 100).toFixed(0)}%</span>
                    <span className="text-gray-600"> ({accuracy.totalPredictions} predictions)</span>
                  </span>
                )}
                {accuracy && accuracy.totalPredictions < 5 && (
                  <span className="text-xs text-gray-500">Accuracy: Building history...</span>
                )}
              </div>
            </SheetHeader>

            {/* ── Live Chart + Predicted Trajectory ─────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Price Chart & Prediction Trajectory</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-indigo-400" />Historical</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 border-t-2 border-dashed border-amber-400" />Predicted</span>
                </div>
              </div>
              <div className="h-52 bg-gray-900/50 rounded-xl p-2 border border-gray-800">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fill: "#6b7280", fontSize: 10 }}
                        domain={["auto", "auto"]}
                        tickFormatter={(v) => `₹${(v as number).toLocaleString("en-IN")}`}
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                        labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                        formatter={(value: any, name: string) => [
                          typeof value === "number" && isFinite(value) 
                            ? `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                            : "N/A",
                          name === "price" ? "Price" : "Predicted",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#6366f1"
                        fill="#6366f115"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      {/* Animated dashed predicted line */}
                      <Line
                        type="monotone"
                        dataKey="predicted"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={<PulseDot data={chartData} />}
                        connectNulls={false}
                        activeDot={{ r: 5, fill: "#f59e0b" }}
                      />
                      <ReferenceLine
                        y={displayPrice?.lastPrice}
                        stroke="#4b5563"
                        strokeDasharray="4 2"
                        label={{ value: "Current", fill: "#6b7280", fontSize: 10 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    {stockId ? "Loading chart data..." : "Chart not available in preview mode"}
                  </div>
                )}
              </div>
              {predictedPrice > 0 && displayPrice?.lastPrice && (
                <div className={`text-xs text-center font-medium ${predictedPrice >= displayPrice.lastPrice ? "text-green-400" : "text-red-400"}`}>
                  Predicted target: ₹{predictedPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  {" "}({predictedPrice >= displayPrice.lastPrice ? "+" : ""}{(((predictedPrice - displayPrice.lastPrice) / displayPrice.lastPrice) * 100).toFixed(2)}%)
                </div>
              )}
            </div>

            {/* ── Prediction Breakdown ───────────────────────────────────── */}
            {(() => {
              const rsiVal = displayPrediction?.rsi ?? null;
              const macdVal = displayPrediction?.macd ?? null;
              const sma20Val = displayPrediction?.sma20 ?? null;
              const sma50Val = displayPrediction?.sma50 ?? null;
              const currentPriceVal = displayPrice?.lastPrice ?? sma20Val ?? 0;
              const sentimentVal = displayPrediction?.sentimentScore ?? null;

              // Use the same normalised scores as PredictionBreakdownPopup so both views agree
              const rsiScore = rsiVal != null ? getRsiScore(rsiVal) : null;
              const macdScore = macdVal != null ? getMacdScore(macdVal, currentPriceVal) : null;
              const smaScore = (sma20Val != null && sma50Val != null) ? getSmaTrendScore(sma20Val, sma50Val, currentPriceVal) : null;

              // Weighted combined score (only from available data)
              const weights = [
                [rsiScore, 0.30],
                [macdScore, 0.35],
                [smaScore, 0.20],
                [sentimentVal, 0.15],
              ] as [number | null, number][];
              const available = weights.filter(([v]) => v != null);
              const totalWeight = available.reduce((s, [, w]) => s + w, 0);
              const combinedScore = totalWeight > 0
                ? Math.round(available.reduce((s, [v, w]) => s + (v! * w), 0) / totalWeight)
                : null;

              return (
                <div className={`rounded-xl p-4 border space-y-3 ${signalColors[signal]}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Prediction Breakdown</h3>
                    <span className="text-xs opacity-70">
                      {combinedScore != null ? `Combined: ${combinedScore}/100` : "Calculating..."}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <BreakdownBar
                      label={`RSI (14) — ${rsiVal != null ? rsiVal.toFixed(1) : "—"}`}
                      value={rsiScore ?? 0}
                      maxValue={100}
                      color="bg-indigo-500"
                      noData={rsiScore == null}
                    />
                    <BreakdownBar
                      label={`MACD — ${macdVal != null ? `${macdVal > 0 ? "+" : ""}${macdVal.toFixed(3)}` : "—"}`}
                      value={macdScore ?? 0}
                      maxValue={100}
                      color="bg-blue-500"
                      noData={macdScore == null}
                    />
                    <BreakdownBar
                      label={`SMA Trend — ${sma20Val != null && sma50Val != null ? (sma20Val > sma50Val ? "20>50" : sma20Val < sma50Val ? "20<50" : "20=50") : "—"}`}
                      value={smaScore ?? 0}
                      maxValue={100}
                      color="bg-purple-500"
                      noData={smaScore == null}
                    />
                    <BreakdownBar
                      label={`Sentiment — ${sentimentVal != null ? `${sentimentVal}/100` : "—"}`}
                      value={sentimentVal ?? 0}
                      maxValue={100}
                      color="bg-teal-500"
                      noData={sentimentVal == null}
                    />
                  </div>
                  <p className="text-xs opacity-60 pt-1 border-t border-current/20">
                    {signal === "BUY"
                      ? "Technical indicators and sentiment align for a potential upside move."
                      : signal === "SELL"
                      ? "Technical weakness and sentiment deterioration suggest downside risk."
                      : "Mixed signals — no clear directional bias detected."}
                  </p>
                </div>
              );
            })()}

            {/* ── Technical Indicators Grid ─────────────────────────────── */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">Technical Indicators</h3>
              <div className="grid grid-cols-2 gap-2">
                <IndicatorCard
                  label="RSI (14)"
                  value={(() => { const v = technicals?.rsi ?? displayPrediction?.rsi; return v != null ? v.toFixed(2) : "—"; })()}
                  sub={(() => { const v = technicals?.rsi ?? displayPrediction?.rsi; if (v == null) return "—"; return v < 30 ? "Oversold" : v > 70 ? "Overbought" : "Neutral"; })()}
                />
                <IndicatorCard
                  label="MACD"
                  value={(() => { const v = technicals?.macd ?? displayPrediction?.macd; return v != null ? `${v > 0 ? "+" : ""}${v.toFixed(3)}` : "—"; })()}
                  sub={(() => { const v = technicals?.macd ?? displayPrediction?.macd; if (v == null) return "—"; return v > 0 ? "Bullish" : "Bearish"; })()}
                />
                <IndicatorCard
                  label="SMA 20"
                  value={(() => { const v = technicals?.sma20 ?? displayPrediction?.sma20; return v != null ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"; })()}
                />
                <IndicatorCard
                  label="SMA 50"
                  value={(() => { const v = technicals?.sma50 ?? displayPrediction?.sma50; return v != null ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"; })()}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-800/40 rounded-lg p-2 text-center">
                  <div className="text-gray-500 mb-1">Open</div>
                  <div className="text-white font-medium">₹{typeof displayPrice?.open === "number" ? displayPrice.open.toFixed(2) : "—"}</div>
                </div>
                <div className="bg-gray-800/40 rounded-lg p-2 text-center">
                  <div className="text-gray-500 mb-1">High</div>
                  <div className="text-green-400 font-medium">₹{typeof displayPrice?.high === "number" ? displayPrice.high.toFixed(2) : "—"}</div>
                </div>
                <div className="bg-gray-800/40 rounded-lg p-2 text-center">
                  <div className="text-gray-500 mb-1">Low</div>
                  <div className="text-red-400 font-medium">₹{typeof displayPrice?.low === "number" ? displayPrice.low.toFixed(2) : "—"}</div>
                </div>
              </div>
            </div>

            {/* ── Fibonacci-EMA Analysis Panel ───────────────────────────────── */}
            {(() => {
              const fib = fibAnalysisData?.fibAnalysis;
              if (!fib) return null;
              const signalColor = fib.signal === 'BUY' ? 'text-green-400' : fib.signal === 'SELL' ? 'text-red-400' : 'text-yellow-400';
              const borderColor = fib.signal === 'BUY' ? 'border-green-500/30' : fib.signal === 'SELL' ? 'border-red-500/30' : 'border-yellow-500/30';
              const bgColor = fib.signal === 'BUY' ? 'bg-green-500/5' : fib.signal === 'SELL' ? 'bg-red-500/5' : 'bg-yellow-500/5';
              const alertBg = fibAlert?.alertTier === 'TRIGGERED' ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-amber-500/10 border-amber-500/30';

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-1.5">
                      <GitBranch className="h-4 w-4 text-amber-400" />
                      Fibonacci-EMA Analysis
                    </h3>
                    {fibAlert && (
                      <button
                        onClick={() => setFibAlert(null)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold border animate-pulse ${alertBg}`}
                      >
                        <Zap className="h-3 w-3" />
                        {fibAlert.alertTier === 'TRIGGERED' ? 'TRIGGERED' : fibAlert.alertTier === 'AT_ZONE' ? 'AT ZONE' : 'APPROACHING'}
                        {" – "}{fibAlert.fibLevel}
                      </button>
                    )}
                  </div>

                  <div className={`rounded-xl p-4 border space-y-3 ${bgColor} ${borderColor}`}>
                    {/* Signal row */}
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${signalColor}`}>{fib.signal}</span>
                      <span className="text-xs text-gray-400">Confidence: <span className="text-white font-semibold">{(fib.confidence * 100).toFixed(0)}%</span></span>
                    </div>

                    {/* Nearest Fib level */}
                    {fib.nearestZone && (
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between text-gray-400">
                          <span>Nearest Zone</span>
                          <span className="text-white font-mono">
                            ₹{fib.nearestZone.priceCenter.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ({(fib.nearestZone.fibRatio * 100).toFixed(1)}% Fib)
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-400">
                          <span>Zone Strength</span>
                          <span className="text-white">
                            {'★'.repeat(fib.nearestZone.strength)}{'☆'.repeat(5 - fib.nearestZone.strength)}
                          </span>
                        </div>
                        {fib.nearestZone.emaPeriod && (
                          <div className="flex justify-between text-gray-400">
                            <span>EMA Confluence</span>
                            <span className="text-amber-400 font-semibold">{fib.nearestZone.emaPeriod}-EMA</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* EMA Stack */}
                    <div className="text-xs space-y-1">
                      <div className="flex justify-between text-gray-400">
                        <span>EMA Stack</span>
                        <span className={`font-semibold ${
                          fib.emaStack.trend === 'BULLISH' ? 'text-green-400'
                          : fib.emaStack.trend === 'BEARISH' ? 'text-red-400'
                          : 'text-yellow-400'
                        }`}>{fib.emaStack.trend}</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {([9, 21, 50, 200] as const).map(period => (
                          <span key={period} className="bg-gray-800 rounded px-1.5 py-0.5 text-gray-300 font-mono">
                            EMA{period}: ₹{(fib.emaStack[`ema${period}` as keyof typeof fib.emaStack] as number).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Candle Pattern */}
                    {fib.candlePattern.name !== 'No Pattern' && fib.candlePattern.name !== 'None' && (
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Pattern</span>
                        <span className={`font-semibold ${
                          fib.candlePattern.signal === 'BUY' ? 'text-green-400'
                          : fib.candlePattern.signal === 'SELL' ? 'text-red-400'
                          : 'text-gray-300'
                        }`}>{fib.candlePattern.name} ({(fib.candlePattern.reliability * 100).toFixed(0)}%)</span>
                      </div>
                    )}

                    {/* VWAP */}
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>VWAP</span>
                      <span className={`font-semibold ${fib.isAboveVwap ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{fib.vwap.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ({fib.isAboveVwap ? 'Above' : 'Below'})
                      </span>
                    </div>

                    {/* SL / TP / R:R */}
                    {fib.signal !== 'HOLD' && fib.entryZone && (
                      <div className="border-t border-gray-700 pt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="text-center">
                          <div className="text-gray-500 mb-0.5">Stop Loss</div>
                          <div className="text-red-400 font-mono font-semibold">
                            ₹{(fib.stopLoss ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 mb-0.5">Target 1</div>
                          <div className="text-green-400 font-mono font-semibold">
                            ₹{(fib.target1 ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-gray-500 mb-0.5">R:R Ratio</div>
                          <div className="text-white font-semibold">{fib.riskReward ?? '—'}:1</div>
                        </div>
                      </div>
                    )}

                    {/* Reasoning */}
                    <p className="text-xs text-gray-500 italic border-t border-gray-700/50 pt-2">{fib.reasoning}</p>
                  </div>
                </div>
              );
            })()}

            {/* ── Related Stocks ─────────────────────────────────────────── */}
            {related && related.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-300">Related Stocks (Same Sector)</h3>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {related.map((r) => {
                    const rSignalColor = r.signal === "BUY" ? "border-green-500/40 bg-green-500/5" : r.signal === "SELL" ? "border-red-500/40 bg-red-500/5" : "border-yellow-500/30 bg-yellow-500/5";
                    const rPctChange = r.percentChange ?? 0;
                    return (
                      <button
                        key={r.id}
                        onClick={() => onSelectRelated(r.id)}
                        className={`flex-shrink-0 w-28 rounded-xl border p-3 text-center hover:scale-105 transition-transform cursor-pointer ${rSignalColor}`}
                      >
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-2 text-xs font-bold text-white">
                          {r.symbol.replace(".NS", "").slice(0, 3)}
                        </div>
                        <div className="text-xs font-semibold text-white truncate">{r.symbol.replace(".NS", "")}</div>
                        <div className={`text-xs font-bold mt-0.5 ${r.signal === "BUY" ? "text-green-400" : r.signal === "SELL" ? "text-red-400" : "text-yellow-400"}`}>
                          {r.signal}
                        </div>
                        {r.lastPrice != null && (
                          <div className="text-xs text-gray-400 mt-0.5">₹{r.lastPrice.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
                        )}
                        {rPctChange !== 0 && (
                          <div className={`text-xs ${rPctChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {rPctChange >= 0 ? "+" : ""}{rPctChange.toFixed(2)}%
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── News Sentiment (collapsible) ───────────────────────────── */}
            {news && news.length > 0 && (
              <div className="space-y-2">
                <button
                  className="flex items-center justify-between w-full text-sm font-semibold text-gray-300 hover:text-white transition-colors"
                  onClick={() => setNewsExpanded((v) => !v)}
                >
                  <span>News Sentiment ({news.length})</span>
                  {newsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {newsExpanded && (
                  <div className="space-y-2">
                    {news.map((item, idx) => {
                      const badgeClass =
                        item.sentimentLabel === "POSITIVE"
                          ? "bg-green-500/10 text-green-400 border-green-500/30"
                          : item.sentimentLabel === "NEGATIVE"
                          ? "bg-red-500/10 text-red-400 border-red-500/30"
                          : "bg-gray-700 text-gray-300 border-gray-600";
                      return (
                        <div key={idx} className="bg-gray-800/50 rounded-lg p-3 space-y-1">
                          <div className="flex items-start gap-2">
                            <Badge className={`text-xs shrink-0 border ${badgeClass}`}>{item.sentimentLabel ?? "NEUTRAL"}</Badge>
                            <p className="text-xs text-gray-300 leading-relaxed">{item.headline}</p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{item.source}</span>
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
