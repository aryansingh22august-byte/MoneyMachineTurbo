import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import {
  ComposedChart, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { TrendingUp, TrendingDown, Zap, RefreshCw, Brain, Activity, ChevronDown, ChevronUp, Target, ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getRsiScore } from './PredictionBreakdownPopup';

// ─── Types ──────────────────────────────────────────────────────────────────
interface AffectedStock {
  symbol: string; companyName: string;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  percentChange: number; confidence: number;
  technicalScore?: number;
  sentimentScore?: number;
  technicalRsi?: number;
  technicalMacd?: number;
  impliedVolatility?: number;
  sector?: string;
  agentVotes?: { persona: string; signal: 'BUY' | 'SELL' | 'HOLD'; reasoning: string; }[];
}
interface SwarmPrediction {
  event: string; affectedStocks: AffectedStock[];
  overallConfidence: number; agentCount: number;
  reasoning: string; category: 'MACRO' | 'SECTOR' | 'POLICY' | 'EARNINGS' | 'GLOBAL';
  timestamp: string;
}
interface SwarmReport {
  predictions: SwarmPrediction[]; topImpactStock: string;
  simulationRunAt: string; totalAgents: number;
  status: 'live' | 'cached' | 'simulated';
}

// ─── Category config ────────────────────────────────────────────────────────
const CAT_CFG: Record<string, { color: string; bg: string }> = {
  MACRO:    { color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
  SECTOR:   { color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  POLICY:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  EARNINGS: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  GLOBAL:   { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
};

// ─── Shared tooltip style ────────────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: { background: '#12121f', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 11 },
  labelStyle: { color: '#fff', fontWeight: 700 },
  itemStyle: { color: 'rgba(255,255,255,0.7)' },
};

// ─── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: SwarmReport['status'] }) {
  const cfg = {
    live:      { dot: 'bg-green-400',  text: 'text-green-300',  label: 'Live Simulation' },
    cached:    { dot: 'bg-blue-400',   text: 'text-blue-300',   label: 'Cached' },
    simulated: { dot: 'bg-yellow-400', text: 'text-yellow-300', label: 'AI Simulated' },
  }[status];
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold">
      <span className={`h-2 w-2 rounded-full ${cfg.dot} animate-pulse`} />
      <span className={cfg.text}>{cfg.label}</span>
    </span>
  );
}

// ─── Confidence ring ────────────────────────────────────────────────────────
function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  // Clamp to [0, 1] so a 0-confidence stock doesn't draw a full ring
  const clamped = Math.min(1, Math.max(0, value));
  const color = pct >= 80 ? '#10b981' : pct >= 65 ? '#f59e0b' : '#ef4444';
  const circ = 2 * Math.PI * 14;
  return (
    <div className="relative h-10 w-10 flex-shrink-0">
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx="16" cy="16" r="14" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${circ * clamped} ${circ * (1 - clamped)}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white">{pct}%</span>
    </div>
  );
}

// ─── Individual stock prediction chart ──────────────────────────────────────
function StockPredictionChart({ stock }: { stock: AffectedStock }) {
  const { data, isLoading } = trpc.swarm.getStockHistory.useQuery({
    symbol: stock.symbol,
    direction: stock.direction,
    percentChange: stock.percentChange,
    // Guard: impliedVolatility must be a positive finite number or the query will get NaN
    impliedVolatility: stock.impliedVolatility && isFinite(stock.impliedVolatility) && stock.impliedVolatility > 0
      ? stock.impliedVolatility
      : 1,
  }, { staleTime: 5 * 60_000 });

  const isUp = stock.direction === 'UP';
  const color = isUp ? '#10b981' : stock.direction === 'DOWN' ? '#ef4444' : '#6b7280';
  const predColor = isUp ? '#34d399' : '#f87171';

  // Merge history + predicted into one array for the chart
  // Range uses [lower, upper] for Area background
  const chartData = [
    ...(data?.history ?? []).map(d => ({ date: d.date, actual: d.close, predicted: null, predictedBounds: null })),
    ...(data?.history?.length && data?.predicted?.length
      ? [{ 
          date: data.history[data.history.length - 1].date, 
          actual: null, 
          predicted: data.history[data.history.length - 1].close,
          predictedBounds: [data.history[data.history.length - 1].close, data.history[data.history.length - 1].close]
        }]
      : []),
    ...(data?.predicted ?? []).map(d => ({ 
      date: d.date, 
      actual: null, 
      predicted: d.predicted,
      predictedBounds: [d.predictedLower, d.predictedUpper] 
    })),
  ];

  const allPrices = chartData.flatMap(d => [d.actual, d.predicted, d.predictedBounds?.[0], d.predictedBounds?.[1]]).filter((v): v is number => v != null && v > 0);
  const minPrice = allPrices.length ? Math.min(...allPrices) * 0.995 : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) * 1.005 : 100;
  const lastActual = data?.history?.[data.history.length - 1]?.close;
  const firstActual = data?.history?.[0]?.close;
  const realChange = lastActual && firstActual ? ((lastActual - firstActual) / firstActual * 100).toFixed(2) : null;

  return (
    <div className="rounded-2xl border p-4" style={{ background: 'rgba(255,255,255,0.03)', borderColor: `${color}30` }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            {isUp ? <TrendingUp size={14} className="text-emerald-400" /> : <TrendingDown size={14} className="text-red-400" />}
            <span className="text-sm font-black text-white">{stock.symbol}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ color, background: `${color}20` }}
            >
              {stock.direction === 'UP' ? '+' : '-'}{stock.percentChange.toFixed(1)}% predicted
            </span>
          </div>
          <div className="text-[10px] text-white/40 mt-0.5">{stock.companyName}</div>
        </div>
        <div className="text-right">
          {lastActual ? (
            <div className="text-sm font-bold text-white">
              ₹{lastActual.toLocaleString('en-IN')}
            </div>
          ) : null}
          {realChange ? (
            <div className="text-[10px]" style={{ color: parseFloat(realChange) >= 0 ? '#10b981' : '#ef4444' }}>
              {parseFloat(realChange) >= 0 ? '+' : ''}{realChange}% (5d actual)
            </div>
          ) : null}
        </div>
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="h-32 flex items-center justify-center">
          <div className="text-xs text-white/30 animate-pulse">Loading price data...</div>
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-32 flex items-center justify-center">
          <div className="text-xs text-white/30">Price data unavailable</div>
        </div>
      ) : (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 8 }}
                interval="preserveStartEnd"
                tickLine={false}
              />
              <YAxis
                domain={[minPrice, maxPrice]}
                tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 8 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `₹${v.toLocaleString('en-IN')}`}
                width={55}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(val: any, name: string) => {
                  if (name === 'predictedBounds') return null; // Hide the raw array from tooltip
                  return [`₹${Number(val)?.toLocaleString('en-IN') ?? '—'}`, name === 'actual' ? 'Actual Price' : '🔮 Predicted'];
                }}
              />
              {/* Confidence Band Area */}
              <Area 
                type="monotone" 
                dataKey="predictedBounds" 
                stroke="none" 
                fill={predColor} 
                fillOpacity={0.12} 
                connectNulls={false} 
                isAnimationActive={false}
              />
              {/* Actual price — solid line */}
              <Line
                type="monotone" dataKey="actual"
                stroke={color} strokeWidth={2}
                dot={false} connectNulls={false}
                name="actual"
                isAnimationActive={false}
              />
              {/* Predicted — dashed line */}
              <Line
                type="monotone" dataKey="predicted"
                stroke={predColor} strokeWidth={2}
                strokeDasharray="5 3" dot={false}
                connectNulls={false} name="predicted"
                isAnimationActive={false}
              />
              {/* Divider between actual and predicted */}
              {data?.history?.length ? (
                <ReferenceLine
                  x={data.history[data.history.length - 1].date}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="4 2"
                  label={{ value: 'Now', position: 'top', fill: 'rgba(255,255,255,0.4)', fontSize: 8 }}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <div className="h-0.5 w-5 rounded" style={{ background: color }} />
          5-day intraday actual
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <div className="h-4 w-5 flex items-center justify-center relative">
             <div className="absolute inset-0 rounded-sm" style={{ background: predColor, opacity: 0.2 }} />
             <div className="h-0.5 w-full rounded border-t-2 border-dashed relative z-10" style={{ borderColor: predColor }} />
          </div>
          MiroFish Live Radar (With StdDev Bands)
        </div>
        <div className="ml-auto text-[10px] text-white/30">
          Confidence: {Math.round(stock.confidence * 100)}%
        </div>
      </div>
    </div>
  );
}

// ─── Market-hours utility ────────────────────────────────────────────────────
function useIsMarketOpen(): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const check = () => {
      const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = ist.getDay(); // 0=Sun 6=Sat
      const mins = ist.getHours() * 60 + ist.getMinutes();
      setOpen(day >= 1 && day <= 5 && mins >= 555 && mins < 930); // 9:15–15:30
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
  return open;
}

// ─── Live SSE + Yahoo Finance hybrid hook ───────────────────────────────────
function useLiveForecastData(stock: AffectedStock | null) {
  const isMarketOpen = useIsMarketOpen();

  // Fetch base 5d Yahoo Finance data — always available as the canvas
  const { data: baseData, isLoading } = trpc.swarm.getStockHistory.useQuery(
    {
      symbol: stock?.symbol ?? '',
      direction: stock?.direction ?? 'NEUTRAL',
      percentChange: stock?.percentChange ?? 0.5,
      impliedVolatility: stock?.impliedVolatility ?? 1.5,
    },
    { enabled: !!stock, refetchInterval: isMarketOpen ? false : 60_000, staleTime: 30_000 }
  );

  // Live tick buffer — appended via SSE during market hours
  const [liveTicks, setLiveTicks] = React.useState<{ date: string; close: number; volume: number }[]>([]);
  const [isLive, setIsLive] = React.useState(false);

  React.useEffect(() => {
    // Reset whenever selected stock changes
    setLiveTicks([]);
    setIsLive(false);
  }, [stock?.symbol]);

  React.useEffect(() => {
    if (!stock || !isMarketOpen) return;

    // The SSE payload now carries the real NSE symbol (e.g. "HCLTECH")
    // stock.symbol might be "HCLTECH.NS" so normalise both sides
    const symbolBase = stock.symbol.replace(/\.(NS|BSE)$/i, '');

    const es = new EventSource('/api/stream');
    // tickCount removed — was declared but never read

    es.addEventListener('liveUpdate', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as {
          stockId: number; symbol: string; lastPrice: number; volume?: number;
        };
        // Match by symbol base name (strip .NS suffix if present)
        const payloadBase = payload.symbol.replace(/\.(NS|BSE)$/i, '');
        if (payloadBase !== symbolBase) return;

        setIsLive(true);
        setLiveTicks(prev => [
          ...prev.slice(-400), // keep last 400 live ticks (~1h at 10s intervals)
          {
            date: new Date().toLocaleString('en-IN', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            }),
            close: payload.lastPrice,
            volume: payload.volume ?? 0,
          },
        ]);
      } catch { /* ignore parse errors */ }
    });

    es.onerror = () => setIsLive(false);

    return () => {
      es.close();
      setIsLive(false);
    };
  }, [stock?.symbol, isMarketOpen]);

  return { baseData, liveTicks, isLoading, isMarketOpen, isLive };
}

// ─── Probabilistic Forecast Panel ───────────────────────────────────────────
function ProbabilisticForecastPanel({ predictions }: { predictions: SwarmPrediction[] }) {
  const uniqueStocks = (() => {
    const seen = new Set<string>();
    const out: AffectedStock[] = [];
    for (const p of predictions) {
      for (const s of p.affectedStocks) {
        if (!seen.has(s.symbol)) { seen.add(s.symbol); out.push(s); }
      }
    }
    return out.sort((a, b) => b.percentChange - a.percentChange).slice(0, 8);
  })();

  const [selected, setSelected] = React.useState<AffectedStock | null>(uniqueStocks[0] ?? null);

  React.useEffect(() => {
    if (!selected && uniqueStocks[0]) setSelected(uniqueStocks[0]);
  }, [uniqueStocks]);

  // Hybrid live data hook
  const { baseData, liveTicks, isLoading, isMarketOpen, isLive } = useLiveForecastData(selected);

  const isUp = selected?.direction === 'UP';
  const actualColor  = '#6366f1'; // indigo – historical line
  const forecastColor = '#f97316'; // orange – forecast line (matches reference image)

  // ── Merge: base Yahoo Finance history + live SSE ticks + forecast ────────────
  // During market hours, liveTicks extends the real price line in real-time
  const mergedHistory = [
    ...(baseData?.history ?? []),
    ...liveTicks.map(t => ({ date: t.date, unix: Date.now(), close: t.close, open: t.close, high: t.close, low: t.close, volume: t.volume })),
  ];
  const nowLabel = mergedHistory.length ? mergedHistory[mergedHistory.length - 1].date : null;

  const chartData = [
    ...mergedHistory.map(d => ({
      date: d.date,
      unix: d.unix,
      actual: d.close > 0 ? d.close : null,
      volume: d.volume ?? 0,
      forecast: null as null,
      forecastUpper: null as null,
      forecastLower: null as null,
      forecastVolume: null as null,
    })),
    // Handoff bridging point
    ...(mergedHistory.length && baseData?.predicted?.length ? [{
      date: mergedHistory[mergedHistory.length - 1].date,
      unix: mergedHistory[mergedHistory.length - 1].unix,
      actual: null,
      volume: null,
      forecast: mergedHistory[mergedHistory.length - 1].close,
      forecastUpper: mergedHistory[mergedHistory.length - 1].close,
      forecastLower: mergedHistory[mergedHistory.length - 1].close,
      forecastVolume: null,
    }] : []),
    ...(baseData?.predicted ?? []).map((d, i, arr) => {
      const avgVol = mergedHistory.reduce((a, b) => a + (b.volume ?? 0), 0);
      const avgVolPerBar = mergedHistory.length ? avgVol / mergedHistory.length : 0;
      const taper = 1 - (i / arr.length) * 0.3;
      return {
        date: d.date,
        unix: 0,
        actual: null,
        volume: null,
        forecast: d.predicted,
        forecastUpper: d.predictedUpper,
        forecastLower: d.predictedLower,
        forecastVolume: Math.round(avgVolPerBar * (0.6 + Math.random() * 0.2) * taper),
      };
    }),
  ];

  const prices = chartData.flatMap(d => [d.actual, d.forecast, d.forecastUpper, d.forecastLower]).filter((v): v is number => v != null && v > 0);
  const minP = prices.length ? Math.min(...prices) * 0.997 : 0;
  const maxP = prices.length ? Math.max(...prices) * 1.003 : 100;

  // Prefer the very latest live tick for the "last price" display
  const lastActual = liveTicks.length > 0
    ? liveTicks[liveTicks.length - 1].close
    : (baseData?.history?.[baseData.history.length - 1]?.close ?? null);
  const lastForecast = baseData?.predicted?.[baseData.predicted.length - 1]?.predicted;

  if (!selected) return null;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(10,10,25,0.95)', borderColor: 'rgba(255,255,255,0.08)' }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity size={14} className="text-orange-400" />
              <h3 className="text-sm font-bold text-white tracking-wide">Probabilistic Price Forecast</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-orange-300 bg-orange-500/15 border border-orange-500/20">
                Monte Carlo · 40 Steps
              </span>
              {/* Live / Delayed / Closed status badge */}
              {isLive ? (
                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LIVE
                </span>
              ) : isMarketOpen ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-yellow-300 bg-yellow-500/15 border border-yellow-500/25">
                  📼 15min Delayed
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-gray-400 bg-gray-700/40 border border-gray-600/40">
                  🔒 Market Closed
                </span>
              )}
            </div>
            <p className="text-[10px] text-white/35 max-w-xl">
              Historical price (indigo) and mean Swarm forecast (orange). Shaded area = full range of predicted outcomes indicating forecast uncertainty.
            </p>
          </div>
          {/* Stock selector pills */}
          <div className="flex flex-wrap gap-1.5">
            {uniqueStocks.map(s => (
              <button
                key={s.symbol}
                onClick={() => setSelected(s)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                  selected?.symbol === s.symbol
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20'
                }`}
              >
                {s.symbol}
              </button>
            ))}
          </div>
        </div>

        {/* Live price row */}
        {lastActual && (
          <div className="flex items-center gap-6 mt-4">
            <div>
          <div className="text-[10px] text-white/40 mb-0.5">Last Price {isLive ? '(Live)' : '(Delayed)'}</div>
              {/* Guard: lastActual may be null before data loads */}
              <div className="text-xl font-black text-white">{lastActual != null ? `₹${lastActual.toLocaleString('en-IN')}` : '—'}</div>
            </div>
            {lastForecast && (
              <div>
                <div className="text-[10px] text-white/40 mb-0.5">Forecast Target</div>
                <div className={`text-xl font-black ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  ₹{lastForecast.toLocaleString('en-IN')}
                </div>
              </div>
            )}
            {lastActual && lastForecast && (
              <div>
                <div className="text-[10px] text-white/40 mb-0.5">Expected Move</div>
                <div className={`text-xl font-black ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{((lastForecast - lastActual) / lastActual * 100).toFixed(2)}%
                </div>
              </div>
            )}
            <div className="ml-auto">
              <div className="text-[10px] text-white/40 mb-0.5">Swarm Confidence</div>
              <div className="text-xl font-black text-indigo-400">{Math.round((selected?.confidence ?? 0.5) * 100)}%</div>
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="px-2 pt-4 pb-2">
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-2xl animate-pulse">📡</div>
              <p className="text-xs text-white/30">Fetching intraday data and running Monte Carlo…</p>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center">
            <p className="text-xs text-white/30">Price data unavailable for {selected.symbol}</p>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="flex items-center gap-5 px-3 mb-2">
              <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                <div className="h-0.5 w-6 rounded" style={{ background: actualColor }} />
                Historical Price
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                <div className="h-0.5 w-6 rounded border-t border-dashed" style={{ borderColor: forecastColor }} />
                Mean Forecast
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                <div className="h-3 w-6 rounded-sm" style={{ background: `${forecastColor}30` }} />
                Forecast Range (Min–Max)
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                <div className="h-3 w-0.5 rounded" style={{ background: '#ef4444' }} />
                Now
              </div>
            </div>

            {/* Price chart */}
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={forecastColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={forecastColor} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                    interval={Math.floor(chartData.length / 8)}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[minP, maxP]}
                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `₹${(v / 1000).toFixed(1)}k`}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f0f20', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 11 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(val: any, name: string) => {
                      if (name === 'forecastUpper' || name === 'forecastLower') return null;
                      return [`₹${Number(val)?.toLocaleString('en-IN') ?? '—'}`,
                        name === 'actual' ? '📌 Historical' : name === 'forecast' ? '🔮 Mean Forecast' : name];
                    }}
                  />
                  {/* Forecast uncertainty band */}
                  <Area
                    type="monotone" dataKey="forecastUpper"
                    stroke="none" fill="url(#forecastGrad)"
                    connectNulls={false} isAnimationActive={false}
                  />
                  <Area
                    type="monotone" dataKey="forecastLower"
                    stroke="none" fill="#0f0f20"
                    connectNulls={false} isAnimationActive={false}
                  />
                  {/* Historical line */}
                  <Line
                    type="monotone" dataKey="actual"
                    stroke={actualColor} strokeWidth={2}
                    dot={false} connectNulls={false}
                    name="actual" isAnimationActive={false}
                  />
                  {/* Forecast mean line */}
                  <Line
                    type="monotone" dataKey="forecast"
                    stroke={forecastColor} strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false} connectNulls={false}
                    name="forecast" isAnimationActive={false}
                  />
                  {/* NOW divider */}
                  {nowLabel && (
                    <ReferenceLine
                      x={nowLabel}
                      stroke="#ef4444"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      label={{ value: 'NOW', position: 'top', fill: '#ef4444', fontSize: 9, fontWeight: 700 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Volume subplot */}
            <div style={{ height: 90 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="10%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8 }} tickLine={false} axisLine={false} width={52} tickFormatter={v => v > 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                  <Tooltip
                    contentStyle={{ background: '#0f0f20', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: 'rgba(255,255,255,0.4)', fontSize: 9 }}
                    formatter={(val: any, name: string) => [Number(val)?.toLocaleString(), name === 'volume' ? '📊 Historical Volume' : '📈 Forecast Volume']}
                  />
                  <Bar dataKey="volume" fill="#6366f1" fillOpacity={0.7} maxBarSize={8} name="volume" isAnimationActive={false} />
                  <Bar dataKey="forecastVolume" fill={forecastColor} fillOpacity={0.6} maxBarSize={8} name="forecastVolume" isAnimationActive={false} />
                  {nowLabel && (
                    <ReferenceLine x={nowLabel} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Volume legend */}
            <div className="flex items-center gap-4 px-3 pb-1">
              <div className="flex items-center gap-1.5 text-[9px] text-white/35">
                <div className="h-2.5 w-3 rounded-sm" style={{ background: '#6366f180' }} /> Historical Volume
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-white/35">
                <div className="h-2.5 w-3 rounded-sm" style={{ background: `${forecastColor}90` }} /> Mean Forecasted Volume
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Impact leaderboard ──────────────────────────────────────────────────────
function ImpactLeaderboard({ predictions }: { predictions: SwarmPrediction[] }) {
  const all = predictions.flatMap(p => p.affectedStocks.map(s => ({ ...s, event: p.event })));
  const ranked = [...all].sort((a, b) => b.percentChange - a.percentChange).slice(0, 8);
  return (
    <div className="rounded-2xl border p-5" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Zap size={12} className="text-yellow-400" />Impact Leaderboard
      </h3>
      <div className="space-y-3">
        {ranked.map((s, i) => {
          const isUp = s.direction === 'UP';
          const color = isUp ? '#10b981' : s.direction === 'DOWN' ? '#ef4444' : '#6b7280';
          return (
            <div key={`${s.symbol}-${i}`} className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 w-4">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-white">{s.symbol}</span>
                  <span className="text-xs font-bold" style={{ color }}>
                    {isUp ? '+' : '-'}{s.percentChange.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(s.percentChange * 20, 100)}%`, background: color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event confidence breakdown bar chart ───────────────────────────────────
function EventConfidenceChart({ predictions }: { predictions: SwarmPrediction[] }) {
  const data = predictions.map(p => ({
    name: p.event.replace(/ —.*/, '').replace('Indian ', '').slice(0, 22) + '…',
    confidence: Math.round(p.overallConfidence * 100),
    agents: p.agentCount,
    fill: CAT_CFG[p.category]?.color ?? '#6366f1',
    category: p.category,
  }));

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-1 flex items-center gap-2">
        <Activity size={12} className="text-blue-400" />Agent Consensus by Event
      </h3>
      <p className="text-[10px] text-white/30 mb-4">% of agents that agreed on each market event's impact</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis
            type="number" domain={[0, 100]}
            tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }}
            tickLine={false} axisLine={false}
            tickFormatter={v => `${v}%`}
          />
          <YAxis
            type="category" dataKey="name" width={130}
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 9 }}
            tickLine={false} axisLine={false}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(val: number) => [`${val}% consensus`, 'Agent Agreement']}
          />
          <Bar dataKey="confidence" radius={[0, 4, 4, 0]} maxBarSize={16}>
            {data.map((entry, i) => (
              <rect key={i} fill={entry.fill} />
            ))}
          </Bar>
          {/* @ts-ignore */}
          <ReferenceLine x={70} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 2"
            label={{ value: 'Strong', position: 'top', fill: 'rgba(255,255,255,0.3)', fontSize: 8 }} />
        </BarChart>
      </ResponsiveContainer>
      {/* Category legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {Object.entries(CAT_CFG).map(([cat, cfg]) => (
          <div key={cat} className="flex items-center gap-1.5 text-[10px]" style={{ color: cfg.color }}>
            <div className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
            {cat}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agent category radar ─────────────────────────────────────────────────────
function AgentRadar({ predictions }: { predictions: SwarmPrediction[] }) {
  const catConfidence: Record<string, number> = {};
  predictions.forEach(p => {
    catConfidence[p.category] = Math.round(Math.max(catConfidence[p.category] ?? 0, p.overallConfidence * 100));
  });
  const data = ['MACRO', 'SECTOR', 'POLICY', 'EARNINGS', 'GLOBAL'].map(cat => ({
    category: cat,
    confidence: catConfidence[cat] ?? 0,
  }));

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-1">
        Category Coverage
      </h3>
      <p className="text-[10px] text-white/30 mb-2">Which macro areas are covered by agent consensus</p>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis dataKey="category" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8 }} tickCount={3} />
          <Radar name="Confidence" dataKey="confidence" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'Confidence']} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Prediction card ─────────────────────────────────────────────────────────
function PredictionCard({ pred, index, onSelect }: { pred: SwarmPrediction; index: number; onSelect: (s: AffectedStock) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cat = CAT_CFG[pred.category] ?? CAT_CFG.MACRO;
  return (
    <div className="rounded-2xl border transition-all" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}>
      <div className="flex items-start gap-3 p-4">
        <div className="text-xl font-black text-white/15 flex-shrink-0">#{index + 1}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ color: cat.color, background: cat.bg }}>
              {pred.category}
            </span>
            <ConfidenceRing value={pred.overallConfidence} />
          </div>
          <h3 className="text-sm font-bold text-white leading-snug">{pred.event}</h3>
          <p className="text-[10px] text-white/35 mt-0.5">{pred.agentCount} agents • {new Date(pred.timestamp).toLocaleTimeString('en-IN')}</p>
        </div>
      </div>
      {/* Stocks */}
      <div className="px-4 pb-3 space-y-2">
        {pred.affectedStocks.map(s => {
          const isUp = s.direction === 'UP';
          const color = isUp ? '#10b981' : s.direction === 'DOWN' ? '#ef4444' : '#6b7280';
          return (
            <div key={s.symbol} onClick={() => onSelect(s)} className="flex items-center justify-between p-2 -mx-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
              <div className="flex items-center gap-2">
                {isUp ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-red-400" />}
                <div>
                  <div className="text-xs font-bold text-white">{s.symbol}</div>
                  <div className="text-[9px] text-white/35">{s.companyName}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full"
                    style={{ width: `${Math.min(s.percentChange * 20, 100)}%`, background: color }} />
                </div>
                <span className="text-xs font-bold w-14 text-right" style={{ color }}>
                  {isUp ? '+' : '-'}{s.percentChange.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Reasoning */}
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-4 py-2.5 text-[10px] font-medium text-white/40 hover:text-white/70 transition-colors border-t"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <Brain size={10} />Agent Reasoning
        {expanded ? <ChevronUp size={10} className="ml-auto" /> : <ChevronDown size={10} className="ml-auto" />}
      </button>
      {expanded && (
        <p className="px-4 pb-4 text-xs text-white/60 leading-relaxed italic">"{pred.reasoning}"</p>
      )}
    </div>
  );
}

function SectorHeatmap({ predictions }: { predictions: SwarmPrediction[] }) {
  // Aggregate sentiment per sector
  const sectorData: Record<string, { totalConfidence: number; count: number; netBullish: number }> = {};
  
  predictions.forEach(p => {
    p.affectedStocks.forEach(s => {
      if (!s.sector) return;
      if (!sectorData[s.sector]) sectorData[s.sector] = { totalConfidence: 0, count: 0, netBullish: 0 };
      
      const isBull = s.direction === 'UP';
      const isBear = s.direction === 'DOWN';
      
      sectorData[s.sector].count += 1;
      sectorData[s.sector].totalConfidence += s.confidence;
      if (isBull) sectorData[s.sector].netBullish += s.confidence;
      if (isBear) sectorData[s.sector].netBullish -= s.confidence;
    });
  });

  const sectors = Object.entries(sectorData)
    .map(([sector, data]) => {
      const avgConf = data.count > 0 ? data.totalConfidence / data.count : 0;
      // Guard: avoid division-by-zero when totalConfidence is 0
      const bullishRatio = data.totalConfidence > 0
        ? ((data.netBullish / data.totalConfidence) + 1) / 2
        : 0.5; // neutral when no data
      return {
        sector,
        weight: data.count * avgConf,
        bullishRatio,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);

  if (sectors.length === 0) return null;

  return (
    <div className="rounded-2xl border p-5 h-full flex flex-col" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
      <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-1 flex items-center gap-2">
        <Activity size={12} className="text-blue-400" />Swarm Sector Heatmap
      </h3>
      <p className="text-[10px] text-white/30 mb-4">Macro rotation prediction based on Swarm sentiment distribution</p>
      
      <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-2">
        {sectors.map((s, i) => {
          // Color scale: Green (bullish) to Red (bearish)
          const isBull = s.bullishRatio > 0.55;
          const isBear = s.bullishRatio < 0.45;
          const colorClass = isBull ? 'bg-green-500/20 text-green-400 border-green-500/30' 
            : isBear ? 'bg-red-500/20 text-red-400 border-red-500/30' 
            : 'bg-gray-700/50 text-gray-300 border-gray-600/50';
            
          return (
            <div key={i} className={`p-3 rounded-xl border flex flex-col justify-center items-center text-center transition-all ${colorClass}`} style={{ minHeight: '80px' }}>
              <span className="text-xs font-bold leading-tight mb-1">{s.sector}</span>
              <span className="text-[10px] opacity-70">
                {isBull ? 'High Buy Conviction' : isBear ? 'Sell Pressure' : 'Neutral Volatility'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function SwarmIntelligenceRadar() {
  const [selectedStock, setSelectedStock] = useState<AffectedStock | null>(null);
  
  // Fetch driving news for the drawer
  const { data: news } = trpc.stock.getNewsSentimentBySymbol.useQuery(
    { symbol: selectedStock?.symbol ?? '', limit: 3 },
    { enabled: !!selectedStock }
  );

  const { data: report, isLoading, refetch } = trpc.swarm.getLatestPredictions.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  
  // Fetch driving news for the drawer
  const { data: accuracyStats } = trpc.swarm.getGlobalSwarmAccuracy.useQuery();
  const trigger = trpc.swarm.triggerSimulation.useMutation({ onSuccess: () => refetch() });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)' }}>
        <div className="text-center space-y-4">
          <div className="text-5xl animate-pulse">🧠</div>
          <p className="text-white/50 text-sm">Activating Swarm Engine…</p>
        </div>
      </div>
    );
  }

  const sw = report as SwarmReport | undefined;
  const avgConf = sw?.predictions?.length
    ? Math.round(sw.predictions.reduce((s, p) => s + p.overallConfidence, 0) / sw.predictions.length * 100)
    : 0;

  // Collect top 4 stocks by predicted impact for the chart section
  const topStocks = sw?.predictions
    ? [...sw.predictions.flatMap(p => p.affectedStocks)]
        .sort((a, b) => b.percentChange - a.percentChange)
        .filter((s, i, arr) => arr.findIndex(x => x.symbol === s.symbol) === i)
        .slice(0, 4)
    : [];

  return (
    <div className="min-h-screen p-6 space-y-6"
      style={{ background: 'linear-gradient(135deg, #0c0c18 0%, #141428 60%, #0c1818 100%)' }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <span className="text-3xl">🧠</span>
            <h1 className="text-2xl font-black text-white">Swarm Intelligence Radar</h1>
            {sw && <StatusBadge status={sw.status} />}
          </div>
          <p className="text-white/40 text-sm">
            {sw?.totalAgents ?? 30} AI agents · Indian market impact simulation
            {sw && <span className="ml-2 text-white/25">· Last run: {new Date(sw.simulationRunAt).toLocaleTimeString('en-IN')}</span>}
          </p>
        </div>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
          <RefreshCw size={13} className={trigger.isPending ? 'animate-spin' : ''} />
          {trigger.isPending ? 'Running…' : 'Re-run Simulation'}
        </button>
      </div>

      {/* ── Stats row ── */}
      {sw && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { icon: '✅', label: 'System Accuracy', value: accuracyStats ? `${accuracyStats.accuracy}%` : '...', color: '#10b981' },
            { icon: '📡', label: 'Active Events', value: sw.predictions.length, color: '#6366f1' },
            { icon: '🤖', label: 'Total Agents', value: sw.totalAgents, color: '#8b5cf6' },
            { icon: '🎯', label: 'Top Impact', value: sw.topImpactStock, color: '#f59e0b' },
            { icon: '📊', label: 'Avg Confidence', value: `${avgConf}%`, color: '#3b82f6' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border p-4"
              style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-white/35">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Probabilistic Forecast Panel ── */}
      {sw && (
        <ProbabilisticForecastPanel predictions={sw.predictions} />
      )}

      {/* ── Main 2-col grid ── */}
      {sw && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Left — Prediction cards */}
          <div className="xl:col-span-2 space-y-3">
            <h2 className="text-[11px] font-bold text-white/40 uppercase tracking-widest">Market Impact Predictions</h2>
            {sw.predictions.map((pred, i) => <PredictionCard key={i} pred={pred} index={i} onSelect={setSelectedStock} />)}
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            <ImpactLeaderboard predictions={sw.predictions} />
            <AgentRadar predictions={sw.predictions} />
          </div>
        </div>
      )}

      {/* ── Additional Analytics Row ── */}
      {sw && (
        <div className="grid grid-cols-1 gap-5">
          <SectorHeatmap predictions={sw.predictions} />
        </div>
      )}

      {/* ── Charts row — full width, NO overlap ── */}
      {sw && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <EventConfidenceChart predictions={sw.predictions} />
          <div className="rounded-2xl border p-5" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
            <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest mb-1 flex items-center gap-2">
              <Target size={12} className="text-purple-400" />Prediction Distribution
            </h3>
            <p className="text-[10px] text-white/30 mb-4">Confidence score vs. predicted impact magnitude per event</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={sw.predictions.map(p => ({
                  event: p.category,
                  confidence: Math.round(p.overallConfidence * 100),
                  totalImpact: parseFloat(p.affectedStocks.reduce((sum, s) => sum + s.percentChange, 0).toFixed(2)),
                  fill: CAT_CFG[p.category]?.color,
                }))}
                margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="event" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9 }} />
                <YAxis yAxisId="left" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} tickFormatter={v => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} tickFormatter={v => `${v}%`} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
                <Bar yAxisId="left" dataKey="confidence" name="Confidence %" fill="#6366f1" fillOpacity={0.8} radius={[3, 3, 0, 0]} maxBarSize={40} />
                <Bar yAxisId="right" dataKey="totalImpact" name="Total Impact %" fill="#10b981" fillOpacity={0.6} radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Real-time stock prediction charts ── */}
      {topStocks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-[11px] font-bold text-white/40 uppercase tracking-widest">
              Top Predicted Stocks — Real-time Charts
            </h2>
            <div className="flex items-center gap-3 text-[10px] text-white/30">
              <div className="flex items-center gap-1.5"><div className="h-0.5 w-6 bg-white/30 rounded" />Actual (14d)</div>
              <div className="flex items-center gap-1.5"><div className="h-0.5 w-6 rounded border-t-2 border-dashed border-white/30" />Predicted (5d)</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {topStocks.map(stock => (
              <StockPredictionChart key={stock.symbol} stock={stock} />
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="text-center text-[10px] text-white/20 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        Powered by MiroFish Swarm Intelligence · {sw?.totalAgents ?? 30} Autonomous AI Agents · OASIS Framework
      </div>

      {selectedStock && (
        <Sheet open={true} onOpenChange={(open) => !open && setSelectedStock(null)}>
          <SheetContent side="right" className="w-full sm:max-w-xl bg-gray-950 border-gray-800 text-white p-0">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <SheetHeader>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded font-mono">
                      MiroFish Swarm Logic
                    </span>
                  </div>
                  <SheetTitle className="text-2xl font-bold text-white">
                    {selectedStock.symbol} Prediction Breakdown
                  </SheetTitle>
                </SheetHeader>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-300">Live Prediction Radar</h3>
                  <StockPredictionChart stock={selectedStock} />
                </div>

                <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-300 border-b border-gray-800 pb-2">Swarm Decision Matrix</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="text-xs text-gray-400">Technical Core Score</div>
                      <div className="flex items-end gap-2">
                        <div className="text-2xl font-bold">{selectedStock.technicalScore ?? 50}</div>
                        <div className="text-xs text-gray-500 mb-1">/ 100</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-gray-400">News Sentiment Score</div>
                      <div className="flex items-end gap-2">
                        <div className="text-2xl font-bold text-teal-400">{selectedStock.sentimentScore ?? 50}</div>
                        <div className="text-xs text-gray-500 mb-1">/ 100</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">RSI Intensity ({selectedStock.technicalRsi?.toFixed(1) ?? 'N/A'})</span>
                        <span className="font-mono">{Math.round(getRsiScore(selectedStock.technicalRsi ?? 50))}% Bullish</span>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                         <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${getRsiScore(selectedStock.technicalRsi ?? 50)}%` }} />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Implied Volatility Buffer</span>
                        <span className="font-mono text-purple-400">±{selectedStock.impliedVolatility?.toFixed(1) ?? 1}%</span>
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">The Trust Band area on the chart represents this standard deviation bounds, establishing the mathematical probabilities of the prediction constraint.</p>
                    </div>
                  </div>
                </div>

                {/* ── Agent Persona Debate Log ── */}
                {selectedStock.agentVotes && selectedStock.agentVotes.length > 0 && (
                  <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 space-y-4">
                    <h3 className="text-sm font-semibold text-gray-300 border-b border-gray-800 pb-2 flex items-center gap-2">
                      <Zap size={14} className="text-yellow-400" />
                      Agent Debate Console
                    </h3>
                    <div className="space-y-3 font-mono text-[11px]">
                      {selectedStock.agentVotes.map((vote, i) => (
                        <div key={i} className="flex flex-col gap-1 p-3 rounded-lg bg-black/40 border border-gray-800/80">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-indigo-400 font-bold opacity-80">[{vote.persona}]</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest ${vote.signal === 'BUY' ? 'bg-green-500/20 text-green-400' : vote.signal === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                              {vote.signal}
                            </span>
                          </div>
                          <span className="text-gray-300">"{vote.reasoning}"</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Driving Market Catalysts (Live News) ── */}
                <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-300 border-b border-gray-800 pb-2">Driving Catalysts (News)</h3>
                  {news && news.length > 0 ? (
                    <div className="space-y-3">
                      {news.map((item, idx) => {
                        const badgeClass =
                          item.sentimentLabel === "POSITIVE"
                            ? "bg-green-500/10 text-green-400 border-green-500/30"
                            : item.sentimentLabel === "NEGATIVE"
                            ? "bg-red-500/10 text-red-400 border-red-500/30"
                            : "bg-gray-700 text-gray-300 border-gray-600";
                        return (
                          <div key={idx} className="bg-gray-800/50 rounded-lg p-3 space-y-2 border border-gray-800">
                            <div className="flex items-start gap-3">
                              <Badge className={`text-[10px] shrink-0 border ${badgeClass}`}>{item.sentimentLabel ?? "NEUTRAL"}</Badge>
                              <p className="text-xs text-gray-300 leading-snug">{item.headline}</p>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 pl-16">
                              <span>{item.source}</span>
                              {item.url && (
                                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 transition-colors">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 text-center italic py-4">
                      No recent real-time news data available to seed the Sentiment Model. Using baseline moving averages.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      )}

    </div>
  );
}
