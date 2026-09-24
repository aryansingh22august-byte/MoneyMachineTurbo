/**
 * TradingViewChart.tsx
 * Professional-grade candlestick chart using lightweight-charts v5 by TradingView.
 * - Renders actual OHLCV candlesticks from historical data
 * - Updates the last candle in real-time from the SSE live price feed
 * - Optional toggleable overlays: AI Prediction Markers, MA lines, Volume bars
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { TradingViewLiveChart } from './TradingViewWidgets';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  ColorType,
  CrosshairMode,
  IPriceLine,
  createSeriesMarkers,
} from 'lightweight-charts';
import { trpc } from '@/lib/trpc';
import { useLivePriceUpdates } from '@/hooks/useRealtimeUpdates';
import { BarChart2, TrendingUp, Activity, Cpu, GitBranch, Zap } from 'lucide-react';

// ── Indicator math (client-side) ─────────────────────────────────────────────
function calcSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    return data.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
  });
}
function calcEMAArr(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = data[0];
  data.forEach((v, i) => {
    const ema = i === 0 ? v : v * k + prev * (1 - k);
    out.push(ema);
    prev = ema;
  });
  return out;
}
function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    let gain = 0, loss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    const rs = loss === 0 ? 100 : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}
function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMAArr(closes, fast);
  const emaSlow = calcEMAArr(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMAArr(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}
function calcBB(closes: number[], period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    return { upper: mean + mult * std, mid: mean, lower: mean - mult * std };
  });
}

interface TradingViewChartProps {
  stockId: number;
  symbol: string;
  onElementClick?: (element: string, data: Record<string, unknown>) => void;
}

// Range tabs
type Range = '1d' | '5d' | '1mo' | '3mo';
type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';

interface RangeConfig {
  label: string;
  range: Range;
  interval: Interval;
  group: 'intraday' | 'swing' | 'tick';
  bucketSec: number;
}

const RANGE_CONFIG: RangeConfig[] = [
  // ── Tick ──
  { label: 'Tick', range: '1d', interval: '1m', group: 'tick',     bucketSec: 1 },
  // ── Intraday ──
  { label: '1m',   range: '1d',  interval: '1m',  group: 'intraday', bucketSec: 60 },
  { label: '5m',   range: '1d',  interval: '5m',  group: 'intraday', bucketSec: 300 },
  { label: '15m',  range: '5d',  interval: '15m', group: 'intraday', bucketSec: 900 },
  { label: '30m',  range: '5d',  interval: '30m', group: 'intraday', bucketSec: 1800 },
  { label: '1H',   range: '1d',  interval: '1h',  group: 'intraday', bucketSec: 3600 },
  // ── Swing ──
  { label: '1D',   range: '1d',  interval: '5m',  group: 'swing',    bucketSec: 300 },
  { label: '5D',   range: '5d',  interval: '15m', group: 'swing',    bucketSec: 900 },
  { label: '1M',   range: '1mo', interval: '1d',  group: 'swing',    bucketSec: 86400 },
  { label: '3M',   range: '3mo', interval: '1d',  group: 'swing',    bucketSec: 86400 },
];

// Toggleable overlays
interface Overlays {
  aiSignals: boolean;
  maLines: boolean;
  volume: boolean;
  fibonacci: boolean;
  bb: boolean;       // Bollinger Bands
  rsiPane: boolean;  // RSI sub-chart
  macdPane: boolean; // MACD sub-chart
  smc: boolean;      // Smart Money Concepts
}

export function TradingViewChart({ stockId, symbol, onElementClick }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef   = useRef<HTMLDivElement>(null);
  const macdContainerRef  = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef  = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const tickSeriesRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const sma20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const sma50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeRef  = useRef<ISeriesApi<'Histogram'> | null>(null);
  // RSI / MACD series refs (created once, data refreshed on each OHLC load)
  const rsiLineRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSigRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastCandleTimeRef = useRef<number | null>(null);
  // Tick chart: accumulate live SSE points
  const tickPointsRef = useRef<LineData<Time>[]>([]);
  // Active live candle tracking to preserve wicks
  const activeCandleRef = useRef<{ time: Time; open: number; high: number; low: number; close: number } | null>(null);
  const markersPluginRef = useRef<any>(null);

  const [chartMode, setChartMode] = useState<'ai' | 'live'>('ai');
  const [activeRange, setActiveRange] = useState<RangeConfig>(RANGE_CONFIG[7]); // default: 5D swing
  const isTickMode = activeRange.group === 'tick';
  const [overlays, setOverlays] = useState<Overlays>({
    aiSignals: false,
    maLines: true,
    volume: true,
    fibonacci: false,
    bb: false,
    rsiPane: false,
    macdPane: false,
    smc: true, // Default ON for pro view
  });
  // Track active fib price lines so we can remove them on toggle
  const fibPriceLinesRef = useRef<IPriceLine[]>([]);
  // Track SMC price lines (FVG boundaries, etc)
  const smcPriceLinesRef = useRef<IPriceLine[]>([]);

  const { prices } = useLivePriceUpdates();
  const liveUpdate = prices.get(stockId);

  // Normalise symbol for Yahoo Finance: ensure it has .NS suffix
  const yahooSymbol = symbol.includes('.') ? symbol : `${symbol}.NS`;

  // Fetch OHLC from Yahoo Finance via our new tRPC endpoint
  const { data: ohlcBars, isLoading: ohlcLoading } = trpc.swarm.getOHLCHistory.useQuery(
    { symbol: yahooSymbol, range: activeRange.range, interval: activeRange.interval },
    { staleTime: 5 * 60_000 }
  );

  // Fibonacci levels — fetched only when overlay is toggled on
  const { data: fibData } = trpc.fibonacci.getFibLevels.useQuery(
    { symbol: yahooSymbol },
    { staleTime: 5 * 60_000, enabled: overlays.fibonacci }
  );

  // Prediction history for AI markers toggle
  const { data: predictions } = trpc.prediction.getHistory.useQuery(
    { stockId, limit: 30 },
    { staleTime: 5 * 60_000, enabled: overlays.aiSignals }
  );

  // ── Chart Initialization ──────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chartOpts = (bg = '#0d0d0d') => ({
      layout: { background: { type: ColorType.Solid, color: bg }, textColor: '#9ca3af', fontFamily: "'Inter', 'system-ui', sans-serif", fontSize: 11 },
      grid: { vertLines: { color: '#1f2937', style: 1 }, horzLines: { color: '#1f2937', style: 1 } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4b5563', labelBackgroundColor: '#374151' }, horzLine: { color: '#4b5563', labelBackgroundColor: '#374151' } },
      rightPriceScale: { borderColor: '#1f2937', textColor: '#9ca3af' },
      timeScale: { borderColor: '#1f2937', timeVisible: true, secondsVisible: true },
      handleScroll: true, handleScale: true,
    });

    const chart = createChart(chartContainerRef.current, { ...chartOpts(), width: chartContainerRef.current.clientWidth, height: 420 });

    // Candlestick
    const candleSeries = chart.addSeries(CandlestickSeries, { upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444', wickUpColor: '#10b981', wickDownColor: '#ef4444' });
    candleSeriesRef.current = candleSeries;

    // Tick line series (hidden by default, shown in tick mode)
    const tickSeries = chart.addSeries(LineSeries, { color: '#06b6d4', lineWidth: 1, lastValueVisible: true, priceLineVisible: false, visible: false });
    tickSeriesRef.current = tickSeries;

    // SMA 20 / 50
    const sma20 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: 2, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
    const sma50 = chart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 1, lineStyle: 2, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
    sma20Ref.current = sma20; sma50Ref.current = sma50;

    // Bollinger Bands
    const bbOpts = { lineWidth: 1 as const, lineStyle: 3, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'right' };
    bbUpperRef.current = chart.addSeries(LineSeries, { ...bbOpts, color: '#6366f150', visible: false });
    bbMidRef.current   = chart.addSeries(LineSeries, { ...bbOpts, color: '#6366f1', visible: false });
    bbLowerRef.current = chart.addSeries(LineSeries, { ...bbOpts, color: '#6366f150', visible: false });

    // Volume
    const volume = chart.addSeries(HistogramSeries, { color: '#1d4ed8', priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeRef.current = volume;

    // RSI sub-chart: create series once, reuse
    if (rsiChartRef.current) {
      if (!rsiLineRef.current) {
        rsiLineRef.current = rsiChartRef.current.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1 as const, lastValueVisible: true, priceLineVisible: false });
        rsiLineRef.current.createPriceLine({ price: 70, color: '#ef444460', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'OB' });
        rsiLineRef.current.createPriceLine({ price: 30, color: '#10b98160', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'OS' });
      }
    }
    // MACD sub-chart: create series once, reuse
    if (macdChartRef.current) {
      if (!macdLineRef.current) {
        macdLineRef.current = macdChartRef.current.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1 as const, lastValueVisible: true, priceLineVisible: false });
        macdSigRef.current  = macdChartRef.current.addSeries(LineSeries, { color: '#fb923c', lineWidth: 1 as const, lastValueVisible: true, priceLineVisible: false });
        macdHistRef.current = macdChartRef.current.addSeries(HistogramSeries, { color: '#10b981', priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
      }
    }

    // RSI sub-chart
    let rsiChart: IChartApi | null = null;
    if (rsiContainerRef.current) {
      rsiChart = createChart(rsiContainerRef.current, { ...chartOpts('#0a0a0a'), width: rsiContainerRef.current.clientWidth, height: 120 });
      rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 }, borderColor: '#1f2937' });
      rsiChartRef.current = rsiChart;
      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) rsiChart!.timeScale().setVisibleLogicalRange(r); });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) chart.timeScale().setVisibleLogicalRange(r); });
    }

    // MACD sub-chart
    let macdChart: IChartApi | null = null;
    if (macdContainerRef.current) {
      macdChart = createChart(macdContainerRef.current, { ...chartOpts('#0a0a0a'), width: macdContainerRef.current.clientWidth, height: 120 });
      macdChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 }, borderColor: '#1f2937' });
      macdChartRef.current = macdChart;
      chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) macdChart!.timeScale().setVisibleLogicalRange(r); });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) chart.timeScale().setVisibleLogicalRange(r); });
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      if (rsiContainerRef.current && rsiChartRef.current) rsiChartRef.current.applyOptions({ width: rsiContainerRef.current.clientWidth });
      if (macdContainerRef.current && macdChartRef.current) macdChartRef.current.applyOptions({ width: macdContainerRef.current.clientWidth });
    });
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    if (rsiContainerRef.current) ro.observe(rsiContainerRef.current);
    if (macdContainerRef.current) ro.observe(macdContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove(); rsiChart?.remove(); macdChart?.remove();
      chartRef.current = null; rsiChartRef.current = null; macdChartRef.current = null;
      candleSeriesRef.current = null; tickSeriesRef.current = null;
      sma20Ref.current = null; sma50Ref.current = null;
      bbUpperRef.current = null; bbMidRef.current = null; bbLowerRef.current = null;
      volumeRef.current = null;
      rsiLineRef.current = null; macdLineRef.current = null; macdSigRef.current = null; macdHistRef.current = null;
    };
  }, []); // only once

  // ── Load Yahoo Finance OHLC data & compute indicators ──────────────────────
  useEffect(() => {
    if (!ohlcBars || !candleSeriesRef.current) return;

    // Deduplicate timestamps (required by lightweight-charts to prevent duplicate time error)
    const timeMap = new Map<number, typeof ohlcBars[0]>();
    for (const d of ohlcBars) {
      if (d.open > 0 && d.high > 0 && d.low > 0 && d.close > 0) {
        const sec = Math.floor(d.unix / 1000);
        if (sec > 0) timeMap.set(sec, d);
      }
    }

    const sorted = Array.from(timeMap.values()).sort((a, b) => a.unix - b.unix);

    const candles: CandlestickData<Time>[] = sorted.map(d => ({
      time: Math.floor(d.unix / 1000) as Time,
      open: d.open, high: d.high, low: d.low, close: d.close,
    }));

    const closes = sorted.map(d => d.close);
    const times  = sorted.map(d => Math.floor(d.unix / 1000) as Time);

    if (candles.length > 0) {
      candleSeriesRef.current.setData(candles);
      lastCandleTimeRef.current = candles[candles.length - 1].time as number;
      chartRef.current?.timeScale().fitContent();
    }

    // SMA lines
    const sma20vals = calcSMA(closes, 20);
    const sma50vals = calcSMA(closes, 50);
    sma20Ref.current?.setData((times.map((t, i) => sma20vals[i] != null ? { time: t, value: sma20vals[i]! } : null).filter(Boolean)) as LineData<Time>[]);
    sma50Ref.current?.setData((times.map((t, i) => sma50vals[i] != null ? { time: t, value: sma50vals[i]! } : null).filter(Boolean)) as LineData<Time>[]);

    // Bollinger Bands
    const bbVals = calcBB(closes);
    const bbU: LineData<Time>[] = [], bbM: LineData<Time>[] = [], bbL: LineData<Time>[] = [];
    bbVals.forEach((v, i) => { if (v) { bbU.push({ time: times[i], value: v.upper }); bbM.push({ time: times[i], value: v.mid }); bbL.push({ time: times[i], value: v.lower }); } });
    bbUpperRef.current?.setData(bbU); bbMidRef.current?.setData(bbM); bbLowerRef.current?.setData(bbL);

    // Volume
    if (volumeRef.current) {
      volumeRef.current.setData(sorted.filter(d => d.volume > 0).map(d => ({
        time: Math.floor(d.unix / 1000) as Time,
        value: d.volume,
        color: d.close >= d.open ? '#10b98133' : '#ef444433',
      })));
    }

    // RSI sub-chart
    if (rsiLineRef.current && closes.length > 14) {
      const rsiVals = calcRSI(closes);
      rsiLineRef.current.setData((times.map((t, i) => rsiVals[i] != null ? { time: t, value: rsiVals[i]! } : null).filter(Boolean)) as LineData<Time>[]);
      rsiChartRef.current?.timeScale().fitContent();
    }

    // MACD sub-chart
    if (macdLineRef.current && macdSigRef.current && macdHistRef.current && closes.length > 26) {
      const { macdLine, signalLine, histogram } = calcMACD(closes);
      macdLineRef.current.setData(times.map((t, i) => ({ time: t, value: macdLine[i] })) as LineData<Time>[]);
      macdSigRef.current.setData(times.map((t, i) => ({ time: t, value: signalLine[i] })) as LineData<Time>[]);
      macdHistRef.current.setData(times.map((t, i) => ({ time: t, value: histogram[i], color: histogram[i] >= 0 ? '#10b98166' : '#ef444466' })));
      macdChartRef.current?.timeScale().fitContent();
    }
  }, [ohlcBars]);


  // ── Overlay visibility ────────────────────────────────────────────────────
  useEffect(() => { sma20Ref.current?.applyOptions({ visible: overlays.maLines }); sma50Ref.current?.applyOptions({ visible: overlays.maLines }); }, [overlays.maLines]);
  useEffect(() => { volumeRef.current?.applyOptions({ visible: overlays.volume }); }, [overlays.volume]);
  useEffect(() => {
    bbUpperRef.current?.applyOptions({ visible: overlays.bb });
    bbMidRef.current?.applyOptions({ visible: overlays.bb });
    bbLowerRef.current?.applyOptions({ visible: overlays.bb });
  }, [overlays.bb]);
  // RSI/MACD pane divs are shown/hidden via CSS — data already loaded above

  // ── Fibonacci Overlay ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove existing fib lines first
    for (const line of fibPriceLinesRef.current) {
      try { candleSeriesRef.current.removePriceLine(line); } catch { /* ignore */ }
    }
    fibPriceLinesRef.current = [];

    if (!overlays.fibonacci || !fibData?.fibLevels) return;

    // Colour by Fib ratio
    const fibColour = (ratio: number): string => {
      if (ratio === 0.382) return '#f59e0b'; // amber — shallow (38.2%)
      if (ratio === 0.500) return '#3b82f6'; // blue  — midpoint (50%)
      if (ratio === 0.618) return '#10b981'; // green — golden (61.8%)
      if (ratio === 0.786) return '#ef4444'; // red   — deep (78.6%)
      if (ratio === 0.236) return '#8b5cf6'; // violet — weak (23.6%)
      if (ratio > 1)       return '#f97316'; // orange — extension
      return '#6b7280'; // grey — 0% / 100%
    };

    const retracements = fibData.fibLevels.filter(l => l.levelType === 'retracement' && l.ratio > 0 && l.ratio < 1);
    const extensions   = fibData.fibLevels.filter(l => l.levelType === 'extension');

    for (const level of [...retracements, ...extensions.slice(0, 2)]) {
      const line = candleSeriesRef.current.createPriceLine({
        price: level.price,
        color: fibColour(level.ratio),
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `Fib ${level.label}`,
      });
      fibPriceLinesRef.current.push(line);
    }

    // Add VWAP line
    if (fibData.vwap && fibData.vwap > 0) {
      const vwapLine = candleSeriesRef.current.createPriceLine({
        price: fibData.vwap,
        color: '#06b6d4',
        lineWidth: 1,
        lineStyle: 1, // dotted
        axisLabelVisible: true,
        title: 'VWAP',
      });
      fibPriceLinesRef.current.push(vwapLine);
    }
  }, [overlays.fibonacci, fibData]);

  // ── AI Signal Markers ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    if (!overlays.aiSignals || !predictions || predictions.length === 0) {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers([]);
      }
      return;
    }

    const markers = predictions
      .filter(p => (p.signal === 'BUY' || p.signal === 'SELL') && p.timestamp)
      .map(p => ({
        time: Math.floor(new Date(p.timestamp as string).getTime() / 1000) as Time,
        position: p.signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color: p.signal === 'BUY' ? '#10b981' : '#ef4444',
        shape: p.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: p.signal,
      }));

    // Sort markers by time ascending
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    
    // Deduplicate timestamps to prevent lightweight-charts crash
    const uniqueMarkers = markers.filter((m, index, self) =>
      index === 0 || m.time !== self[index - 1].time
    );

    try {
      if (!markersPluginRef.current) {
        markersPluginRef.current = createSeriesMarkers(candleSeriesRef.current, uniqueMarkers as any);
      } else {
        markersPluginRef.current.setMarkers(uniqueMarkers as any);
      }
    } catch (e) {
      console.warn("[TradingViewChart] Failed to set AI markers:", e);
    }
  }, [overlays.aiSignals, predictions]);

  // ── Real-time Live Price Tick ─────────────────────────────────────────────
  useEffect(() => {
    if (!liveUpdate) return;
    const { lastPrice, change } = liveUpdate;
    if (!lastPrice || lastPrice <= 0) return;
    const now = Math.floor(Date.now() / 1000);

    if (isTickMode && tickSeriesRef.current) {
      // In tick mode: append every SSE update as a separate point
      const point: LineData<Time> = { time: now as Time, value: lastPrice };
      // Avoid duplicate timestamps
      const last = tickPointsRef.current[tickPointsRef.current.length - 1];
      if (!last || (last.time as number) < now) {
        tickPointsRef.current = [...tickPointsRef.current.slice(-999), point];
        tickSeriesRef.current.update(point);
      } else {
        // Same second — update in place
        tickPointsRef.current[tickPointsRef.current.length - 1] = point;
        tickSeriesRef.current.update(point);
      }
      return;
    }

    if (!candleSeriesRef.current) return;
    const bucketSize = activeRange.bucketSec;
    const candleTime = (Math.floor(now / bucketSize) * bucketSize) as Time;
    
    let activeCandle = activeCandleRef.current;
    
    // Start a new candle if the time bucket has advanced
    if (!activeCandle || activeCandle.time !== candleTime) {
      const openPrice = ohlcBars?.[ohlcBars.length - 1]?.close ?? lastPrice;
      activeCandle = {
        time: candleTime,
        open: activeCandle ? activeCandle.close : openPrice,
        high: activeCandle ? Math.max(activeCandle.close, lastPrice) : Math.max(openPrice, lastPrice),
        low: activeCandle ? Math.min(activeCandle.close, lastPrice) : Math.min(openPrice, lastPrice),
        close: lastPrice
      };
    } else {
      // Update existing candle within the same minute — preserve the wick!
      activeCandle = {
        ...activeCandle,
        high: Math.max(activeCandle.high, lastPrice),
        low: Math.min(activeCandle.low, lastPrice),
        close: lastPrice
      };
    }

    activeCandleRef.current = activeCandle;
    candleSeriesRef.current.update(activeCandle);

    if (volumeRef.current) {
      volumeRef.current.update({ time: candleTime, value: liveUpdate.percentChange ? Math.abs(liveUpdate.percentChange) * 1000 : 0, color: change >= 0 ? '#10b98133' : '#ef444433' });
    }

    // ── SMC Overlays (FVG / AVWAP) ──────────────────────────────────────────
    if (overlays.smc && liveUpdate.smc && candleSeriesRef.current) {
      // Cleanup previous SMC lines
      smcPriceLinesRef.current.forEach(l => candleSeriesRef.current?.removePriceLine(l));
      smcPriceLinesRef.current = [];

      const { fvgs, anchoredVwap } = liveUpdate.smc;

      // Draw active (unfilled) FVGs as price lines (boundaries)
      fvgs.forEach(fvg => {
        const color = fvg.type === 'bullish' ? '#10b981' : '#ef4444';
        const top = candleSeriesRef.current!.createPriceLine({
          price: fvg.top, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `FVG TOP`,
        });
        const bot = candleSeriesRef.current!.createPriceLine({
          price: fvg.bottom, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `FVG BOT`,
        });
        smcPriceLinesRef.current.push(top, bot);
      });

      // Draw Anchored VWAP as a gold price line
      if (anchoredVwap) {
        const vwapLine = candleSeriesRef.current!.createPriceLine({
          price: anchoredVwap, color: '#eab308', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'AVWAP (OPEN)',
        });
        smcPriceLinesRef.current.push(vwapLine);
      }
    } else if (!overlays.smc) {
      smcPriceLinesRef.current.forEach(l => candleSeriesRef.current?.removePriceLine(l));
      smcPriceLinesRef.current = [];
    }
  }, [liveUpdate, ohlcBars, activeRange.bucketSec, isTickMode, overlays.smc]);
  const toggleOverlay = useCallback((key: keyof Overlays) => {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="flex flex-col gap-0 rounded-xl overflow-hidden border border-gray-800 bg-[#0d0d0d]">
      {/* ── Mode Tab Bar ── */}
      <div className="flex items-center gap-0 border-b border-gray-800 bg-[#0a0a0a]">
        <button
          onClick={() => setChartMode('ai')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold tracking-wider transition-all border-b-2 ${
            chartMode === 'ai'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <Cpu className="h-3 w-3" />
          AI Analysis
        </button>
        <button
          onClick={() => setChartMode('live')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold tracking-wider transition-all border-b-2 ${
            chartMode === 'live'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          <svg width="12" height="10" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <path d="M14 28H0L14 0H28L14 28Z" fill={chartMode === 'live' ? '#3b82f6' : '#6b7280'}/>
            <path d="M28 28H22L28 14H34L28 28Z" fill={chartMode === 'live' ? '#3b82f6' : '#6b7280'}/>
          </svg>
          TradingView Live
        </button>
        <div className="ml-auto flex items-center gap-2 pr-3">
          {liveUpdate && chartMode === 'ai' && (
            <span className={`text-sm font-mono font-bold ${liveUpdate.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{liveUpdate.lastPrice.toFixed(2)}
            </span>
          )}
          {chartMode === 'live' && (
            <span className="text-[10px] text-blue-400 font-semibold animate-pulse">● TRADINGVIEW LIVE</span>
          )}
        </div>
      </div>

      {/* ── TradingView Live Chart (shown when mode=live) ── */}
      {chartMode === 'live' && (
        <TradingViewLiveChart symbol={symbol} height={520} />
      )}

      {/* ── AI Chart Header (shown when mode=ai) ── */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-800 ${
        chartMode === 'ai' ? 'flex' : 'hidden'
      }`}>
        <div className="flex items-center gap-3">
          <BarChart2 className="h-4 w-4 text-blue-400" />
          <span className="font-bold text-sm text-white">{symbol}</span>
          {liveUpdate && (
            <span className={`text-sm font-mono font-bold ${liveUpdate.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{liveUpdate.lastPrice.toFixed(2)}
              <span className="text-xs ml-1">
                ({liveUpdate.change >= 0 ? '+' : ''}{liveUpdate.change.toFixed(2)})
              </span>
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            LIVE
          </span>
          {ohlcLoading && <span className="text-[10px] text-gray-500 animate-pulse">Loading history…</span>}
        </div>

        <div className="flex items-center gap-3">
            {/* Timeframe tabs */}
            <div className="flex items-center gap-0 bg-gray-900 rounded-lg p-0.5">
              {/* Tick mode button */}
              <button
                onClick={() => setActiveRange(RANGE_CONFIG[0])}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all flex items-center gap-0.5 ${
                  isTickMode ? 'bg-cyan-600 text-white shadow' : 'text-cyan-700 hover:text-cyan-400'
                }`}
              >
                <Zap className="h-2.5 w-2.5" /> Tick
              </button>
              <span className="mx-1 text-gray-800 text-xs">|</span>
              {/* Intraday group */}
              {RANGE_CONFIG.filter(r => r.group === 'intraday').map(r => (
                <button
                  key={r.label}
                  onClick={() => setActiveRange(r)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                    activeRange.label === r.label
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-gray-600 hover:text-gray-300'
                  }`}
                >
                  {r.label}
                </button>
              ))}
              {/* Divider */}
              <span className="mx-1 text-gray-700 text-xs">|</span>
              {/* Swing group */}
              {RANGE_CONFIG.filter(r => r.group === 'swing').map(r => (
                <button
                  key={r.label}
                  onClick={() => setActiveRange(r)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                    activeRange.label === r.label
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Overlay Toggle Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              {([
                { key: 'aiSignals', label: 'AI', icon: <Cpu className="inline h-3 w-3 mr-0.5" />, accent: 'accent-indigo-500', active: 'text-indigo-400' },
                { key: 'maLines',  label: 'MA', icon: <TrendingUp className="inline h-3 w-3 mr-0.5" />, accent: 'accent-amber-500', active: 'text-amber-400' },
                { key: 'volume',   label: 'Vol', icon: <Activity className="inline h-3 w-3 mr-0.5" />, accent: 'accent-blue-500', active: 'text-blue-400' },
                { key: 'fibonacci',label: 'Fib', icon: <GitBranch className="inline h-3 w-3 mr-0.5" />, accent: 'accent-amber-400', active: 'text-amber-300' },
                { key: 'bb',       label: 'BB',  icon: null, accent: 'accent-violet-500', active: 'text-violet-400' },
                { key: 'rsiPane',  label: 'RSI', icon: null, accent: 'accent-purple-500', active: 'text-purple-400' },
                { key: 'macdPane', label: 'MACD',icon: null, accent: 'accent-sky-500',    active: 'text-sky-400' },
                { key: 'smc',      label: 'SMC', icon: <Zap className="inline h-3 w-3 mr-0.5" />, accent: 'accent-emerald-500', active: 'text-emerald-400' },
              ] as const).map(({ key, label, icon, accent, active }) => (
                <label key={key} className="flex items-center gap-1 cursor-pointer group">
                  <input type="checkbox" checked={overlays[key as keyof Overlays]} onChange={() => toggleOverlay(key as keyof Overlays)} className={`w-3 h-3 ${accent} cursor-pointer`} />
                  <span className={`text-[10px] font-semibold transition-colors ${overlays[key as keyof Overlays] ? active : 'text-gray-500 group-hover:text-gray-300'}`}>
                    {icon}{label}
                  </span>
                </label>
              ))}
            </div>
          </div>
      </div>
      {/* End AI Chart header — wrapped in visibility guard */}

      {/* ── AI-mode panels (hidden when TradingView Live is active) ── */}
      <div className={chartMode === 'ai' ? 'block' : 'hidden'}>

        {/* Tick mode info strip */}
        {isTickMode && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-cyan-500/5 border-b border-cyan-500/20 text-[10px] text-cyan-400">
            <Zap className="h-3 w-3" />
            <span>Tick chart — every live SSE price update plotted as a point. Seeded with today&apos;s historical closes.</span>
            <span className="ml-auto font-mono">{tickPointsRef.current.length} ticks</span>
          </div>
        )}

        {/* ── Main Chart Canvas ── */}
        <div ref={chartContainerRef} className="w-full" />

        {/* ── RSI Sub-chart ── */}
        <div className={`border-t border-gray-800 ${overlays.rsiPane ? 'block' : 'hidden'}`}>
          <div className="px-3 py-1 flex items-center gap-2 bg-[#0a0a0a]">
            <span className="text-[9px] font-bold text-purple-400 uppercase tracking-widest">RSI (14)</span>
            <span className="text-[9px] text-gray-600">— Overbought 70 / Oversold 30</span>
          </div>
          <div ref={rsiContainerRef} className="w-full" />
        </div>

        {/* ── MACD Sub-chart ── */}
        <div className={`border-t border-gray-800 ${overlays.macdPane ? 'block' : 'hidden'}`}>
          <div className="px-3 py-1 flex items-center gap-2 bg-[#0a0a0a]">
            <span className="text-[9px] font-bold text-sky-400 uppercase tracking-widest">MACD (12,26,9)</span>
            <span className="text-[9px] text-gray-600">— Blue: MACD  Orange: Signal  Bars: Histogram</span>
          </div>
          <div ref={macdContainerRef} className="w-full" />
        </div>

      </div> {/* end AI-mode panels */}
    </div>
  );
}
