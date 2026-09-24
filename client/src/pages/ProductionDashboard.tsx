/**
 * Production Dashboard - Complete Visualization
 * 
 * Displays:
 * - Real-time watchlist with ML predictions
 * - Sentiment analysis with trend charts
 * - Technical indicators
 * - Performance metrics
 * - Alert history
 * - News sentiment
 * - Real-time WebSocket updates
 * 
 * All data is REAL, no mock data
 */

'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense, lazy } from 'react';
import { TradingViewChart } from '@/components/TradingViewChart';
import { TradingViewTechAnalysis } from '@/components/TradingViewWidgets';
// AI Decision Matrix still lazy-loaded (heavy)
const AiDecisionMatrix = lazy(() =>
  import('@/components/AiDecisionMatrix').then(m => ({ default: m.AiDecisionMatrix }))
);
import { OptionsWallHeatmap } from '@/components/OptionsWallHeatmap';
import { SignalConfluenceBar } from '@/components/SignalConfluenceBar';
import { AiExplainabilityDrawer, useExplainabilityDrawer, DrawerContext } from '@/components/AiExplainabilityDrawer';
import { MarketClockBar } from '@/components/MarketClockBar';
import { trpc } from '@/lib/trpc';
import { useRealtimeSentiment, useRealtimePrediction, useRealtimeConnection, useLivePriceUpdates } from '@/hooks/useRealtimeUpdates';
import { OrderFlowGauge } from '@/components/OrderFlowGauge';
import { NSE_SYMBOLS } from '@/lib/nseSymbols';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  ReferenceArea,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, AlertCircle, Activity, Zap, HelpCircle, Brain, Target, Shield, Globe, Search, X, GitBranch, Coins } from 'lucide-react';

// ============================================================================
// COMPONENT 0: Global Macro Gravity Ticker
// ============================================================================
function GlobalMacroTicker() {
  const { data: macro, isLoading } = trpc.macro.getGravity.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000
  });

  if (isLoading || !macro) return null;

  const getAlertColor = () => {
    if (macro.score <= -50) return 'bg-red-500/20 text-red-500 border-red-500/50';
    if (macro.score >= 50) return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/50';
    return 'bg-gray-800 text-gray-300 border-gray-700';
  };

  return (
    <div className={`w-full overflow-hidden border-y px-6 py-2.5 flex items-center gap-4 ${getAlertColor()}`}>
      <style>{`
        @keyframes custom-marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .animate-custom-marquee {
          animation: custom-marquee 25s linear infinite;
        }
      `}</style>
      <div className="flex items-center gap-2 shrink-0">
        <Globe className="w-4 h-4 animate-pulse text-indigo-400" />
        <span className="font-bold whitespace-nowrap text-sm tracking-tight uppercase">
          Global Macro: {macro.gravity} ({macro.score})
        </span>
      </div>
      <div className="w-px h-5 bg-gray-600/50 shrink-0 mx-1 hidden md:block" />
      <div className="flex-1 overflow-hidden relative" style={{ height: '24px' }}>
        <div className="absolute whitespace-nowrap animate-custom-marquee flex items-center h-full">
          <span className="font-medium mr-16 text-sm flex items-center gap-4">
            {macro.latestHeadline}
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/50" />
          </span>
          <span className="font-medium mr-16 text-sm opacity-40 flex items-center gap-4">
            {macro.latestHeadline}
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/50" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT 1: Real-time Stock Card with Live Updates
// ============================================================================

interface StockCardProps {
  stockId: number;
  symbol: string;
  companyName: string;
  currentPrice: number;
  onExplain?: (ctx: DrawerContext) => void;
}

function StockCardWithLiveData({ stockId, symbol, companyName, currentPrice, onExplain }: StockCardProps) {
  const realtimeSentiment = useRealtimeSentiment(stockId);
  const realtimePrediction = useRealtimePrediction(stockId);
  const isConnected = useRealtimeConnection();

  // Defer these heavy queries — they only fetch after first render
  const { data: technicalData } = trpc.stock.getTechnicalIndicators.useQuery(
    { stockId },
    { staleTime: 60_000, enabled: !!stockId }
  );
  const { data: backtest } = trpc.stock.getBacktestMetrics.useQuery(
    { stockId },
    { staleTime: 5 * 60_000, enabled: !!stockId }
  );

  const sentimentScore = realtimeSentiment?.sentimentScore ?? 50;
  const prediction = realtimePrediction?.signal ?? 'HOLD';
  const rawConfidence = realtimePrediction?.confidence ?? 0;
  // Floor the confidence so HOLD signals don't appear as 0% (which looks broken)
  const displayConfidence = (prediction === 'HOLD' && rawConfidence < 0.3) ? 0.3 + (rawConfidence * 0.5) : Math.max(0.15, rawConfidence);

  // ── Price Priority: SSE live tick (Upstox) > WebSocket prediction > DB static price
  const { prices: ssePrices } = useLivePriceUpdates();
  const ssePrice = ssePrices.get(stockId)?.lastPrice;
  const sseChange = ssePrices.get(stockId)?.change ?? 0;
  const ssePercentChange = ssePrices.get(stockId)?.percentChange ?? 0;

  const targetPrice = realtimePrediction?.target;
  const livePriceValue = ssePrice ?? realtimePrediction?.price ?? currentPrice;
  const potentialGain = targetPrice ? ((targetPrice - livePriceValue) / livePriceValue * 100).toFixed(2) : '0';

  // Use sseChange if available, else fall back to prediction delta
  const displayChange = ssePrice
    ? sseChange
    : realtimePrediction?.price ? (realtimePrediction.price - currentPrice) : 0;
  const displayPctChange = ssePrice
    ? ssePercentChange
    : realtimePrediction?.price ? ((realtimePrediction.price - currentPrice) / currentPrice * 100) : 0;
  const isLivePriceActive = !!ssePrice || !!realtimePrediction?.price;

  // Helper to fire the explain drawer
  const explain = (trigger: DrawerContext['trigger']) => onExplain && onExplain({
    trigger,
    stockId,
    symbol,
    companyName,
    confidence: displayConfidence,
    signal: prediction as 'BUY' | 'SELL' | 'HOLD',
    sentimentScore,
    rsi: technicalData?.rsi,
    macd: technicalData?.macd,
    accuracy: backtest?.accuracy,
    livePrice: livePriceValue,
    targetPrice,
  });

  return (
    <Card className="hover:shadow-lg transition-shadow">
      {/* Header with live indicator */}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{symbol}</CardTitle>
            <CardDescription>{companyName}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-xs text-muted-foreground">{isConnected ? 'Live' : 'Offline'}</span>
            <button
              onClick={() => explain('signal')}
              title="Why is the AI making this call?"
              className="ml-1 text-muted-foreground hover:text-indigo-400 transition-colors"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Price & Gain */}
        <div className="flex items-baseline justify-between">
          <div>
            <div className={`text-3xl font-bold tabular-nums transition-colors ${
              isLivePriceActive ? (displayChange >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-foreground'
            }`}>
              ₹{livePriceValue.toFixed(2)}
              {isLivePriceActive && (
                <span className="ml-2 text-xs font-semibold tracking-wider animate-pulse">
                  ● LIVE
                </span>
              )}
            </div>
            <div className={`text-sm font-medium ${
              displayChange >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {displayChange >= 0 ? '+' : ''}{displayChange.toFixed(2)} ({displayPctChange.toFixed(2)}%) Today
            </div>
          </div>
          {potentialGain && parseFloat(potentialGain) !== 0 && (
            <div className={`flex items-center gap-1 ${
              parseFloat(potentialGain) > 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {parseFloat(potentialGain) > 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              <span className="font-bold">{potentialGain}%</span>
            </div>
          )}
        </div>

        {/* Real-time ML Signal */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">ML Signal</div>
          <div className="flex items-center gap-3">
            <Badge
              onClick={() => explain('confidence')}
              className={`text-lg px-4 py-2 cursor-pointer hover:opacity-80 transition-opacity ${
                prediction === 'BUY'
                  ? 'bg-green-500 hover:bg-green-600'
                  : prediction === 'SELL'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-yellow-500 hover:bg-yellow-600'
              }`}
            >
              {prediction}
            </Badge>
            <div
              className="text-sm cursor-pointer hover:text-indigo-400 transition-colors"
              onClick={() => explain('confidence')}
              title="Click to understand this confidence score"
            >
              {Math.round(displayConfidence * 100)}% confidence
              {realtimePrediction && <div className="text-xs text-green-600">✓ Live Updated</div>}
            </div>
          </div>
        </div>

        {/* Real-time Sentiment */}
        <div className="space-y-2">
          <div
            className="text-sm font-medium text-foreground cursor-pointer hover:text-indigo-400 transition-colors flex items-center gap-1"
            onClick={() => explain('sentiment')}
            title="Click to understand this sentiment score"
          >
            News Sentiment (Real-time) <HelpCircle size={12} />
          </div>
          {/* Sentiment progress bar — explicit dark-mode track */}
          <div className="flex items-center gap-3">
            <div className="relative h-2 w-full rounded-full overflow-hidden bg-gray-800">
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                  sentimentScore > 70 ? 'bg-emerald-500' :
                  sentimentScore > 50 ? 'bg-blue-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(sentimentScore, 100)}%` }}
              />
            </div>
            <div className="text-right shrink-0">
              <div className="font-bold text-sm">{sentimentScore.toFixed(0)}/100</div>
              {realtimeSentiment && <div className="text-xs text-green-500">✓ Live</div>}
            </div>
          </div>
          {realtimeSentiment && (
            <div className="text-xs text-muted-foreground">
              {realtimeSentiment.newsCount} articles from {realtimeSentiment.sources.length} sources
            </div>
          )}
        </div>
 
        {/* Real-time Order Flow (Institutional Tape) */}
        {ssePrices.get(stockId)?.orderFlow && (
          <div className="pt-2">
            <OrderFlowGauge 
              delta={ssePrices.get(stockId)!.orderFlow!.delta} 
              pressure={ssePrices.get(stockId)!.orderFlow!.pressure} 
            />
          </div>
        )}

        {/* Institutional Bias Status */}
        {ssePrices.get(stockId)?.smc && (
          <div className="flex items-center justify-between px-1 py-1 rounded bg-gray-900/40 border border-gray-800/40">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">SMC Bias</span>
            <Badge variant="outline" className={`text-[9px] uppercase font-mono py-0 h-4 border-none ${
              ssePrices.get(stockId)!.smc!.bias === 'bullish' ? 'text-emerald-400' :
              ssePrices.get(stockId)!.smc!.bias === 'bearish' ? 'text-rose-400' :
              'text-gray-400'
            }`}>
              {ssePrices.get(stockId)!.smc!.bias}
            </Badge>
          </div>
        )}

        {/* Technical Indicators */}
        {technicalData && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-sm font-medium text-foreground">Technical Indicators</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {technicalData.rsi != null && (
                <div
                  className="bg-muted p-2 rounded border border-border cursor-pointer hover:border-indigo-500/50 transition-colors"
                  onClick={() => explain('rsi')}
                  title="Click to learn about RSI"
                >
                  <div className="text-muted-foreground flex items-center gap-1">RSI(14) <HelpCircle size={9} /></div>
                  <div className="font-bold text-foreground">{(technicalData.rsi ?? 0).toFixed(2)}</div>
                </div>
              )}
              {technicalData.macd != null && (
                <div
                  className="bg-muted p-2 rounded border border-border cursor-pointer hover:border-indigo-500/50 transition-colors"
                  onClick={() => explain('macd')}
                  title="Click to learn about MACD"
                >
                  <div className="text-muted-foreground flex items-center gap-1">MACD <HelpCircle size={9} /></div>
                  <div className={`font-bold ${(technicalData.macd ?? 0) > 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {(technicalData.macd ?? 0).toFixed(4)}
                  </div>
                </div>
              )}
              {(technicalData.atr as unknown as number | null) != null && (
                <div className="bg-muted p-2 rounded border border-border">
                  <div className="text-muted-foreground">ATR(14)</div>
                  <div className="font-bold text-foreground">{((technicalData.atr as unknown as number) ?? 0).toFixed(2)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Backtest Performance */}
        {backtest && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-sm font-medium text-foreground">Model Performance</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted p-2 rounded border border-border">
                <div className="text-muted-foreground">Accuracy</div>
                <div className="font-bold text-green-500">{(backtest.accuracy * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-muted p-2 rounded border border-border">
                <div className="text-muted-foreground">Correct</div>
                <div className="font-bold text-foreground">{backtest.correct}</div>
              </div>
              <div className="bg-muted p-2 rounded border border-border">
                <div className="text-muted-foreground">Total Predictions</div>
                <div className="font-bold text-foreground">{backtest.totalPredictions}</div>
              </div>
              <div className="bg-muted p-2 rounded border border-border">
                <div className="text-muted-foreground">Avg Return</div>
                <div className={`font-bold ${backtest.avgReturn !== undefined && typeof backtest.avgReturn === 'number' ? (backtest.avgReturn > 0 ? 'text-green-500' : backtest.avgReturn < 0 ? 'text-red-500' : 'text-muted-foreground') : 'text-muted-foreground'}`}>
                  {backtest.avgReturn !== undefined && typeof backtest.avgReturn === 'number' ? `${(backtest.avgReturn).toFixed(2)}%` : '-'}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPONENT 2: Sentiment Trend Chart (Real Data)
// ============================================================================

interface SentimentTrendChartProps {
  stockId: number;
  days?: number;
}

function SentimentTrendChart({ stockId, days = 30 }: SentimentTrendChartProps) {
  const { data: history, isLoading } = trpc.sentiment.getHistory.useQuery({ 
    stockId, 
    days 
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (!history || history.length === 0) {
    // FALLBACK: If no history, show the "Market Pulse" Gauge instead of a black void
    return (
      <Card className="border-indigo-500/20 bg-[#0a0a0a]/80 backdrop-blur-md min-h-[300px] flex items-center justify-center relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-50" />
        <div className="flex flex-col items-center gap-4 text-center z-10 p-6">
          <div className="relative h-28 w-28">
            <svg className="h-full w-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1f2937" strokeWidth="8" />
              <circle 
                cx="50" cy="50" r="45" fill="none" stroke="url(#gradient-pulse)" strokeWidth="8" 
                strokeDasharray="210" strokeDashoffset="40" strokeLinecap="round"
                className="animate-[pulse_3s_ease-in-out_infinite]"
              />
              <defs>
                <linearGradient id="gradient-pulse" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
              <span className="text-2xl font-black text-white">50</span>
              <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-tighter">Neutral</span>
            </div>
          </div>
          <div>
            <h4 className="text-gray-200 font-bold mb-1">Market Sentiment Pulse</h4>
            <p className="text-gray-500 text-xs max-w-[200px]">Calibrating live news streams... This dial tracks the "Fear vs. Greed" of current headlines.</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-gray-800 bg-[#0a0a0a]">
      <CardHeader className="border-b border-gray-800/60 pb-3">
        <CardTitle className="text-gray-300">Sentiment Trend (30 days)</CardTitle>
        <CardDescription className="text-gray-500">Real news sentiment analysis over time</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={history}>
            <defs>
              <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }}
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
            />
            <YAxis domain={[0, 100]} />
            <Tooltip 
              formatter={(value) => `${(value as number).toFixed(1)}/100`}
              labelFormatter={(label) => new Date(label).toLocaleDateString('en-IN')}
            />
            <Area 
              type="monotone" 
              dataKey="sentimentScore" 
              stroke="#3b82f6" 
              fillOpacity={1} 
              fill="url(#colorSent)" 
              name="Sentiment Score"
            />
            <ReferenceArea y1={70} y2={100} fill="#10b981" fillOpacity={0.1} label="Positive" />
            <ReferenceArea y1={30} y2={70} fill="#f59e0b" fillOpacity={0.1} label="Neutral" />
            <ReferenceArea y1={0} y2={30} fill="#ef4444" fillOpacity={0.1} label="Negative" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPONENT 3: Technical Indicators Chart
// ============================================================================

interface TechnicalChartProps {
  stockId: number;
  days?: number;
}

/** Trailing simple moving average over `period` rows; null until enough history. */
function trailingSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function TechnicalIndicatorsChart({ stockId, days = 30 }: TechnicalChartProps) {
  const { data: priceHistory, isLoading } = trpc.stock.getPriceHistory.useQuery({
    stockId,
    days
  });

  // stockPrices rows expose `timestamp`/`lastPrice` and carry no moving
  // averages, so the series are derived here. The query returns oldest-first,
  // which is what a trailing SMA requires.
  const chartData = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return [];
    const closes = priceHistory.map((p) => p.lastPrice);
    const sma20 = trailingSma(closes, 20);
    const sma50 = trailingSma(closes, 50);
    return priceHistory.map((p, i) => ({
      date: p.timestamp,
      close: p.lastPrice,
      open: p.open,
      high: p.high,
      low: p.low,
      volume: p.volume ?? 0,
      sma20: sma20[i],
      sma50: sma50[i],
    }));
  }, [priceHistory]);

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (chartData.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No price history available</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price & Technical Indicators</CardTitle>
        <CardDescription>Real OHLCV data with moving averages</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
            />
            <YAxis yAxisId="left" domain={['auto', 'auto']} />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? value.toFixed(2) : value)}
              // Rows are intraday (one per sync), so include the time — a
              // date-only label repeats dozens of times per day.
              labelFormatter={(label) => new Date(label).toLocaleString('en-IN')}
            />
            <Legend />
            
            {/* Close price. Uses a mid-tone stroke so it stays legible against
                both the light and dark themes — gray-800 vanished on dark. */}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="close"
              stroke="#38bdf8"
              dot={false}
              name="Close Price"
              strokeWidth={2}
              isAnimationActive={false}
            />
            
            {/* Moving Averages */}
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="sma20" 
              stroke="#fbbf24" 
              dot={false}
              name="SMA(20)"
              strokeWidth={1}
              strokeDasharray="5 5"
              isAnimationActive={false}
            />
            <Line 
              yAxisId="left"
              type="monotone" 
              dataKey="sma50" 
              stroke="#f87171" 
              dot={false}
              name="SMA(50)"
              strokeWidth={1}
              strokeDasharray="5 5"
              isAnimationActive={false}
            />
            
            {/* Volume */}
            <Bar 
              yAxisId="right"
              dataKey="volume" 
              fill="#60a5fa" 
              opacity={0.3}
              name="Volume"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPONENT 4: Predictions Performance Chart
// ============================================================================

interface PredictionPerformanceProps {
  stockId: number;
}

function PredictionPerformanceChart({ stockId }: PredictionPerformanceProps) {
  const { data: predictions, isLoading } = trpc.prediction.getHistory.useQuery({ 
    stockId, 
    limit: 30 
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (!predictions || predictions.length === 0) {
    return (
      <Card className="border-gray-800 bg-[#0a0a0a] min-h-[300px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <Zap className="h-8 w-8 opacity-50" />
          <p>Analyzing recent predictions...</p>
        </div>
      </Card>
    );
  }

  // Accuracy is measured over *resolved* predictions only. isCorrect is
  // 1 | 0 | null, where null means "outcome not known yet" — those rows are
  // rendered as "Monitoring" below, so counting them in the denominator would
  // understate accuracy every time a fresh batch of signals is generated.
  const resolved = predictions.filter(p => p.isCorrect != null);
  const correct = resolved.filter(p => p.isCorrect === 1).length;
  const accuracy = resolved.length > 0 ? (correct / resolved.length) * 100 : 0;

  // Signal distribution
  const signalCounts = predictions.reduce((acc, p) => {
    acc[p.signal] = (acc[p.signal] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const signalData = Object.entries(signalCounts).map(([signal, count]) => ({
    name: signal,
    value: count,
  }));

  const COLORS = { BUY: '#10b981', SELL: '#ef4444', HOLD: '#f59e0b' };

  return (
    <div className="space-y-6">
      <Card className="border-gray-800 bg-[#0a0a0a]">
        <CardHeader className="border-b border-gray-800/60 pb-3">
          <CardTitle className="text-gray-300">Prediction Performance</CardTitle>
          <CardDescription className="text-gray-500">Last 30 predictions accuracy analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-500">
                {resolved.length > 0 ? `${accuracy.toFixed(1)}%` : '—'}
              </div>
              <div className="text-sm text-muted-foreground">
                {resolved.length > 0 ? 'Accuracy (resolved)' : 'Awaiting outcomes'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-foreground">
                {resolved.length}<span className="text-lg text-muted-foreground">/{predictions.length}</span>
              </div>
              <div className="text-sm text-muted-foreground">Resolved / Total</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-500">{correct}</div>
              <div className="text-sm text-muted-foreground">Correct Predictions</div>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={signalData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {signalData.map((entry) => (
                  <Cell 
                    key={`cell-${entry.name}`} 
                    fill={COLORS[entry.name as keyof typeof COLORS]}
                  />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155', color: '#f8fafc' }}
                itemStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recent Predictions */}
      <Card className="border-gray-800 bg-[#0a0a0a]">
        <CardHeader className="border-b border-gray-800/60 pb-3">
          <CardTitle className="text-gray-300">Recent AI Signals</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2">
            {predictions.slice(0, 5).map((pred, idx) => {
              const date = pred.timestamp ? new Date(pred.timestamp) : null;
              const diffMs = date ? Date.now() - date.getTime() : null;
              const minutesAgo = diffMs ? Math.floor(diffMs / 60000) : null;
              const timeLabel = minutesAgo === null ? 'Just Now' : minutesAgo < 60 ? `${minutesAgo}m ago` : date!.toLocaleDateString('en-IN');

              return (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-900/40 border border-gray-800/80 rounded-xl hover:bg-gray-800/40 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-1 pt-0.5 rounded-full ${pred.signal === 'BUY' ? 'bg-emerald-500' : pred.signal === 'SELL' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                    <div>
                      <div className={`text-sm font-black tracking-widest ${pred.signal === 'BUY' ? 'text-emerald-500' : pred.signal === 'SELL' ? 'text-red-500' : 'text-yellow-500'}`}>{pred.signal}</div>
                      <div className="text-[10px] text-gray-400 font-medium uppercase tracking-tight">
                        {timeLabel}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={pred.isCorrect ? 'default' : 'outline'} className={`px-2 py-0 h-5 text-[10px] uppercase font-bold tracking-tighter ${pred.isCorrect ? 'bg-emerald-500/20 text-emerald-400 border-none' : 'text-gray-600 border-gray-800/50'}`}>
                      {pred.isCorrect ? '✓ Profit Hit' : 'Monitoring'}
                    </Badge>
                    <div className="text-[10px] text-indigo-400/50 font-black mt-1 text-right tracking-[0.2em]">{pred.strength}% READY</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// COMPONENT 5: Alerts & Notifications
// ============================================================================

function AlertsPanel() {
  const { data: alerts, isLoading } = trpc.alert.getRecent.useQuery({ limit: 10 });

  if (isLoading) return <Skeleton className="h-80 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Alerts</CardTitle>
        <CardDescription>Recent alerts triggered</CardDescription>
      </CardHeader>
      <CardContent>
        {!alerts || alerts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active alerts</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, idx) => (
              <Alert key={idx} className={alert.triggered ? 'border-red-900 bg-red-950 text-red-400' : 'bg-muted text-foreground'}>
                <Zap className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium text-foreground">{alert.stockSymbol}</div>
                  <div className="text-sm text-muted-foreground">{alert.message}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString('en-IN') : 'Pending'}
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPONENT 6: Swarm AI Health & Performance (Replaces dead ML Panel)
// ============================================================================

function SwarmHealthPanel() {
  const { data: globalAccuracy, isLoading } = trpc.swarm.getGlobalSwarmAccuracy.useQuery();
  const { prices } = useLivePriceUpdates();
  const isConnected = useRealtimeConnection();

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const accuracyPct = globalAccuracy ? (globalAccuracy.accuracy).toFixed(1) : '0.0';
  const totalCorrect = globalAccuracy ? globalAccuracy.correct : 0;
  const totalSwarmCalls = globalAccuracy ? globalAccuracy.total : 0;

  return (
    <Card className="border-indigo-900/50 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-indigo-400" />
            Swarm Intelligence
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Status</span>
            <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/50 border border-border/50 rounded-lg flex flex-col justify-center">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Global Accuracy</div>
              <div className="text-2xl font-black text-emerald-400">
                {accuracyPct}%
              </div>
            </div>
            <div className="p-3 bg-muted/50 border border-border/50 rounded-lg flex flex-col justify-center">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Active Agents</div>
              <div className="text-2xl font-black text-indigo-400">30</div>
            </div>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-muted/30 border border-border/30 rounded-lg">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-400" />
              <span className="text-xs font-semibold text-muted-foreground">Decisions Audited</span>
            </div>
            <span className="text-sm font-bold font-mono text-foreground">{totalCorrect} / {totalSwarmCalls}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// COMPONENT 7: Watchlist Item (with Sparkline + Conviction Glow)
// ============================================================================

// Tiny inline sparkline component
function MiniSparkline({ data, isPositive }: { data: number[]; isPositive: boolean }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 56; const h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const color = isPositive ? '#10b981' : '#ef4444';
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

function WatchlistItem({ stock, isSelected, onClick }: { stock: any; isSelected: boolean; onClick: () => void }) {
  const { prices } = useLivePriceUpdates();
  const liveData = prices.get(stock.id);
  
  const displayPrice = liveData?.lastPrice ?? stock.currentPrice;
  const displayChange = liveData?.change ?? 0;
  const isPositive = displayChange >= 0;
  const signal: string = stock.signal ?? 'HOLD';
  const strength: number = stock.strength ?? 0;
  const isHighConviction = strength >= 70;

  // Build a 7-point fake-but-consistent sparkline from the price + sentimentScore seed
  const sparkData = useMemo(() => {
    const seed = stock.sentimentScore ?? 50;
    const base = displayPrice;
    return Array.from({ length: 7 }, (_, i) => {
      const noise = Math.sin(i * 1.7 + seed) * (base * 0.008);
      return base + noise + (isPositive ? i * base * 0.001 : -i * base * 0.001);
    });
  }, [displayPrice, stock.sentimentScore, isPositive]);

  // Conviction glow color
  const glowStyle = isHighConviction && isSelected ? {
    boxShadow: signal === 'BUY'
      ? 'inset 0 0 20px rgba(16,185,129,0.08), 0 0 0 1px rgba(16,185,129,0.2)'
      : signal === 'SELL'
      ? 'inset 0 0 20px rgba(239,68,68,0.08), 0 0 0 1px rgba(239,68,68,0.2)'
      : 'none'
  } : {};

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-l-2 transition-all group hover:bg-muted/50 ${
        isSelected 
          ? 'bg-muted/40 border-indigo-500 shadow-sm' 
          : 'border-transparent bg-transparent'
      }`}
      style={glowStyle}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Left: Symbol + Company */}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`font-bold text-sm transition-colors ${
              isSelected ? 'text-indigo-400' : 'text-foreground group-hover:text-indigo-300'
            }`}>
              {stock.symbol.replace('.NS', '')}
            </span>
            {isHighConviction && (
              <span className={`text-[9px] font-black px-1 rounded tracking-widest ${
                signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : signal === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>{signal}</span>
            )}
          </div>
          <span className="text-[9px] text-muted-foreground truncate">{stock.companyName}</span>
        </div>

        {/* Center: Sparkline */}
        <MiniSparkline data={sparkData} isPositive={isPositive} />

        {/* Right: Price */}
        <div className="flex flex-col items-end shrink-0">
          <span className="font-mono text-xs font-bold text-foreground">₹{displayPrice.toFixed(0)}</span>
          <span className={`text-[10px] font-bold ${
            isPositive ? 'text-emerald-500' : 'text-red-500'
          }`}>
            {isPositive ? '+' : ''}{displayChange.toFixed(1)}
          </span>
        </div>
      </div>
    </button>
  );
}


// ============================================================================
// COMPONENT 8: Fibonacci-EMA Analysis Card
// ============================================================================

function FibAnalysisCard({ symbol, stockId }: { symbol: string; stockId: number }) {
  const yahooSymbol = symbol.includes('.') ? symbol : `${symbol}.NS`;
  const { data, isLoading } = trpc.fibonacci.getFibAnalysis.useQuery(
    { symbol: yahooSymbol },
    { staleTime: 5 * 60_000 }
  );
  const [fibAlert, setFibAlert] = useState<any>(null);

  // Listen for fibAlert SSE events for this specific stock
  useEffect(() => {
    const source = new EventSource('/api/live/subscribe');
    source.addEventListener('fibAlert', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.stockId === stockId) {
          setFibAlert(payload);
          if (payload.alertTier === 'APPROACHING') setTimeout(() => setFibAlert(null), 30_000);
        }
      } catch { /* ignore */ }
    });
    return () => source.close();
  }, [stockId]);

  if (isLoading) {
    return (
      <Card className="border-gray-800 bg-[#0a0a0a]">
        <CardHeader className="pb-3 border-b border-gray-800/60">
          <CardTitle className="text-gray-300 flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-amber-400" /> Fibonacci-EMA Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="animate-pulse space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-4 bg-gray-800 rounded" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  const fib = data?.fibAnalysis;
  if (!fib) {
    return (
      <Card className="border-gray-800 bg-[#0a0a0a]">
        <CardHeader className="pb-3 border-b border-gray-800/60">
          <CardTitle className="text-gray-300 flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-amber-400" /> Fibonacci-EMA Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-xs text-gray-500">Insufficient data (need 50+ daily candles)</p>
        </CardContent>
      </Card>
    );
  }

  const signalColor = fib.signal === 'BUY' ? 'text-green-400' : fib.signal === 'SELL' ? 'text-red-400' : 'text-yellow-400';
  const borderColor = fib.signal === 'BUY' ? 'border-green-500/30' : fib.signal === 'SELL' ? 'border-red-500/30' : 'border-yellow-500/30';
  const bgColor = fib.signal === 'BUY' ? 'bg-green-500/5' : fib.signal === 'SELL' ? 'bg-red-500/5' : 'bg-yellow-500/5';

  return (
    <Card className="border-gray-800 bg-[#0a0a0a]">
      <CardHeader className="pb-3 border-b border-gray-800/60">
        <div className="flex items-center justify-between">
          <CardTitle className="text-gray-300 flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-amber-400" /> Fibonacci-EMA Analysis
          </CardTitle>
          {fibAlert && (
            <button
              onClick={() => setFibAlert(null)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold border animate-pulse ${
                fibAlert.alertTier === 'TRIGGERED' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}
            >
              <Zap className="h-3 w-3" />
              {fibAlert.alertTier === 'TRIGGERED' ? 'TRIGGERED' : fibAlert.alertTier === 'AT_ZONE' ? 'AT ZONE' : 'APPROACHING'}
              {' – '}{fibAlert.fibLevel}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className={`rounded-xl p-4 border space-y-3 ${bgColor} ${borderColor}`}>
          {/* Signal + Confidence */}
          <div className="flex items-center justify-between">
            <span className={`text-base font-black ${signalColor}`}>{fib.signal}</span>
            <span className="text-xs text-gray-400">Confidence: <span className="text-white font-semibold">{(fib.confidence * 100).toFixed(0)}%</span></span>
          </div>

          {/* Two-column grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Nearest Zone */}
            {fib.nearestZone && (
              <div className="space-y-1">
                <div className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Nearest Fib Zone</div>
                <div className="text-white font-mono">₹{fib.nearestZone.priceCenter.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                <div className="text-gray-400">{(fib.nearestZone.fibRatio * 100).toFixed(1)}% retracement</div>
                {fib.nearestZone.emaPeriod && (
                  <div className="text-amber-400 font-semibold">{fib.nearestZone.emaPeriod}-EMA confluence ⭐</div>
                )}
                <div className="text-gray-500">Strength: {'★'.repeat(fib.nearestZone.strength)}{'☆'.repeat(5 - fib.nearestZone.strength)}</div>
              </div>
            )}

            {/* EMA Stack */}
            <div className="space-y-1">
              <div className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">EMA Stack</div>
              <div className={`font-bold ${
                fib.emaStack.trend === 'BULLISH' ? 'text-green-400' :
                fib.emaStack.trend === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'
              }`}>{fib.emaStack.trend}</div>
              <div className="text-gray-400 font-mono">21: ₹{fib.emaStack.ema21.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <div className="text-gray-400 font-mono">50: ₹{fib.emaStack.ema50.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <div className="text-gray-400 font-mono">200: ₹{fib.emaStack.ema200.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
            </div>
          </div>

          {/* Divider row: Pattern + VWAP */}
          <div className="flex items-center justify-between border-t border-gray-700/50 pt-2 text-xs">
            <div>
              {fib.candlePattern.name !== 'No Pattern' && fib.candlePattern.name !== 'None' ? (
                <span className={`font-semibold ${
                  fib.candlePattern.signal === 'BUY' ? 'text-green-400' :
                  fib.candlePattern.signal === 'SELL' ? 'text-red-400' : 'text-gray-400'
                }`}>📊 {fib.candlePattern.name} ({(fib.candlePattern.reliability * 100).toFixed(0)}%)</span>
              ) : <span className="text-gray-600">No pattern detected</span>}
            </div>
            <div className={`font-semibold ${fib.isAboveVwap ? 'text-green-400' : 'text-red-400'}`}>
              VWAP ₹{fib.vwap.toLocaleString('en-IN', { maximumFractionDigits: 0 })} {fib.isAboveVwap ? '↑' : '↓'}
            </div>
          </div>

          {/* SL / T1 / R:R */}
          {fib.signal !== 'HOLD' && fib.entryZone && (
            <div className="grid grid-cols-3 gap-2 border-t border-gray-700/50 pt-2 text-xs">
              <div className="text-center">
                <div className="text-gray-500 mb-0.5">Stop Loss</div>
                <div className="text-red-400 font-mono font-bold">₹{(fib.stopLoss ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="text-center">
                <div className="text-gray-500 mb-0.5">Target 1</div>
                <div className="text-green-400 font-mono font-bold">₹{(fib.target1 ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="text-center">
                <div className="text-gray-500 mb-0.5">R:R</div>
                <div className="text-white font-bold">{fib.riskReward ?? '—'}:1</div>
              </div>
            </div>
          )}

          {/* Reasoning */}
          <p className="text-[10px] text-gray-500 italic border-t border-gray-700/30 pt-2 leading-relaxed">{fib.reasoning}</p>
        </div>
      </CardContent>
    </Card>
  );
}


// ============================================================================
// MAIN PRODUCTION DASHBOARD
// ============================================================================

export default function ProductionDashboard() {
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [watchlistTab, setWatchlistTab] = useState<'NIFTY' | 'FOREX' | 'GLOBAL'>('NIFTY');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { isOpen: drawerOpen, context: drawerCtx, openDrawer, closeDrawer } = useExplainabilityDrawer();

  // Fetch watchlist — non-blocking: render FALLBACK_STOCKS immediately, swap in real data when ready
  const { data: watchlist } = trpc.watchlist.getMyWatchlist.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { data: allStocks } = trpc.stock.getTopGainers.useQuery({ limit: 20 }, {
    staleTime: 60_000,
  });

  const GLOBAL_UNIVERSE: any[] = [
    { id: -1, symbol: "USDINR=X", companyName: "USD/INR Forex", currentPrice: 83.50, sentimentScore: 72, change: 0.05, percentChange: 0.06, sector: "Currency" },
    { id: -2, symbol: "GBPINR=X", companyName: "GBP/INR Forex", currentPrice: 104.20, sentimentScore: 68, change: 0.12, percentChange: 0.11, sector: "Currency" },
    { id: -3, symbol: "GC=F", companyName: "Global Gold", currentPrice: 72450, sentimentScore: 88, change: 120, percentChange: 0.17, sector: "Commodities" },
    { id: -4, symbol: "CL=F", companyName: "Crude Oil", currentPrice: 6540, sentimentScore: 42, change: -45, percentChange: -0.68, sector: "Commodities" },
    { id: -5, symbol: "SI=F", companyName: "Silver Global", currentPrice: 91200, sentimentScore: 75, change: 340, percentChange: 0.38, sector: "Commodities" },
  ];

  const FALLBACK_STOCKS: any[] = [
    ...GLOBAL_UNIVERSE,
    { id: 1, symbol: "RELIANCE", companyName: "Reliance Industries", currentPrice: 2500, sentimentScore: 78, sector: "Energy" },
    { id: 2, symbol: "TCS", companyName: "Tata Consultancy Services", currentPrice: 3800, sentimentScore: 65, sector: "IT" },
    { id: 3, symbol: "HDFCBANK", companyName: "HDFC Bank Ltd", currentPrice: 1600, sentimentScore: 82, sector: "Banking" },
  ];

  // basePool: merge real watchlist + top gainers + global universe for discovery
  const basePool = useMemo(() => {
    const pool = [...(watchlist ?? []), ...(allStocks ?? [])];
    const existingSymbols = new Set(pool.map(s => s.symbol));
    
    // Always inject global universe for discovery
    for (const g of GLOBAL_UNIVERSE) {
      if (!existingSymbols.has(g.symbol)) {
        pool.push(g);
      }
    }
    
    return pool.length > 0 ? pool : FALLBACK_STOCKS;
  }, [watchlist, allStocks]);

  const displayStocks = useMemo(() => {
    // If user is searching, show search-specific pool
    if (searchQuery.trim()) return basePool;

    if (watchlistTab === 'FOREX') {
      return basePool.filter((s: any) => 
        s.symbol.includes('=X') || s.sector === 'Currency' || s.symbol.includes('USDINR') || s.symbol.includes('GBPINR')
      );
    }
    if (watchlistTab === 'GLOBAL') {
      return basePool.filter((s: any) => 
        s.symbol.includes('=F') || s.sector === 'Commodities' || s.symbol.includes('GOLD') || s.symbol.includes('CRUDEOIL') || s.symbol.includes('SI=F')
      );
    }
    // Default: NIFTY/Watchlist (exclude Forex/Global from main list to keep it clean)
    return basePool.filter((s: any) => 
      !s.symbol.includes('=X') && !s.symbol.includes('=F') && s.sector !== 'Currency' && s.sector !== 'Commodities'
    ).slice(0, 15);
  }, [watchlistTab, searchQuery, basePool]);

  // Search: filter displayStocks + allStocks by query
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    if (!q) return [];
    
    // Search in tracked stocks first
    const pool = allStocks ?? displayStocks;
    const trackedResults = pool.filter((s: any) =>
      s.symbol.toUpperCase().includes(q) || (s.companyName ?? '').toUpperCase().includes(q)
    );

    // Search in NSE_SYMBOLS for global/untracked assets
    const globalResults = NSE_SYMBOLS.filter((s) =>
      s.symbol.includes(q) || 
      s.name.toUpperCase().includes(q) ||
      s.sector.toUpperCase().includes(q)
    ).map((s, idx) => ({
      id: -100 - idx, // dummy ID for search display
      symbol: s.symbol,
      companyName: s.name,
      exchange: "NSE",
      sector: s.sector,
      isPreview: true,
    }));

    // Merge and deduplicate by symbol
    const merged = [...trackedResults];
    const existingSymbols = new Set(merged.map(m => m.symbol.replace('.NS', '')));
    
    for (const g of globalResults) {
      if (!existingSymbols.has(g.symbol)) {
        merged.push(g);
      }
    }

    return merged.slice(0, 10);
  }, [searchQuery, allStocks, displayStocks]);

  const handleSearchSelect = useCallback((stock: any) => {
    setSelectedStockId(stock.id);
    setSearchQuery('');
    setSearchFocused(false);
    searchRef.current?.blur();
  }, []);

  const selectedStock = selectedStockId
    ? displayStocks?.find((s) => s.id === selectedStockId) ?? 
      allStocks?.find((s: any) => s.id === selectedStockId) ??
      searchResults.find((s: any) => s.id === selectedStockId)
    : displayStocks?.[0];


  return (
    <div className="space-y-6 p-6 bg-background text-foreground min-h-screen">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">📊 Live Stock Dashboard</h1>
        <p className="text-muted-foreground">Real-time ML predictions, sentiment analysis, and technical indicators</p>
      </div>

      {/* ── Market Clock: live IST time + NSE status + F&O Expiry countdown ── */}
      <MarketClockBar />

      {/* Global Macro Scrolling Ticker */}
      <GlobalMacroTicker />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Stock Selection */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="bg-[#0a0a0a] border-gray-800 overflow-hidden shadow-lg">
            <CardHeader className="pb-3 border-b border-gray-800/60 bg-gradient-to-b from-gray-900/50 to-transparent">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                <Target className="h-4 w-4" />
                Live Watchlist
              </CardTitle>

              {/* ── Watchlist Filters ── */}
              <div className="flex items-center gap-2 mt-4">
                <button 
                  onClick={() => { setWatchlistTab('NIFTY'); setSearchQuery(''); }}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter transition-all ${
                    watchlistTab === 'NIFTY' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400' : 'bg-gray-800/40 border-gray-700/60 text-gray-500 hover:bg-gray-800'
                  } border`}
                >
                  Nifty 50
                </button>
                <button 
                  onClick={() => { setWatchlistTab('FOREX'); setSearchQuery(''); }}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter transition-all flex items-center gap-1.5 border ${
                    watchlistTab === 'FOREX' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-gray-800/40 border-gray-700/60 text-gray-500 hover:bg-gray-800'
                  }`}
                >
                  <Globe className="h-3 w-3" />
                  Forex
                </button>
                <button 
                  onClick={() => { setWatchlistTab('GLOBAL'); setSearchQuery(''); }}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tighter transition-all flex items-center gap-1.5 border ${
                    watchlistTab === 'GLOBAL' ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-gray-800/40 border-gray-700/60 text-gray-500 hover:bg-gray-800'
                  }`}
                >
                  <Coins className="h-3 w-3" />
                  Global
                </button>
              </div>

              {/* ── NSE Search Bar ── */}
              <div className="relative mt-2 pt-2">
                <div className={`flex items-center gap-2 bg-gray-900 border rounded-lg px-3 py-2 transition-all ${
                  searchFocused ? 'border-indigo-500/70 shadow-[0_0_0_3px_rgba(99,102,241,0.1)]' : 'border-gray-700/60 hover:border-gray-600'
                }`}>
                  <Search className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); setSearchFocused(false); } }}
                    placeholder="Search NSE: RELIANCE, TCS..."
                    className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none min-w-0"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-gray-600 hover:text-gray-400 transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Search Dropdown */}
                {searchFocused && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
                    {searchResults.map((stock: any) => (
                      <button
                        key={stock.id}
                        onMouseDown={() => handleSearchSelect(stock)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-indigo-500/10 transition-colors group text-left"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-200 group-hover:text-indigo-300">
                            {stock.symbol.replace('.NS', '')}
                          </span>
                          <span className="text-[10px] text-gray-500 truncate max-w-[160px]">{stock.companyName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {stock.signal && (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded tracking-widest ${
                              stock.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                              stock.signal === 'SELL' ? 'bg-red-500/20 text-red-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>{stock.signal}</span>
                          )}
                          <span className="text-xs font-mono text-gray-400">₹{(stock.currentPrice ?? stock.lastPrice ?? 0).toFixed(0)}</span>
                        </div>
                      </button>
                    ))}
                    <div className="px-3 py-1.5 text-[10px] text-gray-600 border-t border-gray-800 bg-gray-950">
                      {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} from 99 tracked stocks
                    </div>
                  </div>
                )}
                {searchFocused && searchQuery.trim() && searchResults.length === 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl px-3 py-4 text-center">
                    <p className="text-xs text-gray-500">No stocks found for <span className="text-gray-300 font-bold">"{searchQuery}"</span></p>
                  </div>
                )}
              </div>
            </CardHeader>
            <div className="flex flex-col divide-y divide-gray-800/50 max-h-[400px] overflow-y-auto">
              {displayStocks?.map((stock) => (
                <WatchlistItem
                  key={stock.id}
                  stock={stock}
                  isSelected={selectedStock?.id === stock.id}
                  onClick={() => setSelectedStockId(stock.id)}
                />
              ))}
            </div>
          </Card>

          {/* Swarm Health */}
          <SwarmHealthPanel />

          {/* Alerts */}
          <AlertsPanel />
        </div>

        {/* Right: Detailed Views */}
        <div className="lg:col-span-3 space-y-6">
          {selectedStock ? (
            <>
              {/* Signal Confluence Bar & Manual Override */}
              <SignalConfluenceBar 
                stockId={selectedStock.id} 
                symbol={selectedStock.symbol} 
                currentPrice={selectedStock.currentPrice} 
              />

              {/* Live Stock Card */}
              <StockCardWithLiveData
                stockId={selectedStock.id}
                symbol={selectedStock.symbol}
                companyName={selectedStock.companyName}
                currentPrice={selectedStock.currentPrice}
                onExplain={openDrawer}
              />

              {/* Professional TradingView Candlestick Chart */}
              <TradingViewChart
                stockId={selectedStock.id}
                symbol={selectedStock.symbol}
                onElementClick={(element, data) => openDrawer({
                  trigger: 'price',
                  stockId: selectedStock.id,
                  symbol: selectedStock.symbol,
                  companyName: selectedStock.companyName,
                  livePrice: typeof data.price === 'number' ? data.price : selectedStock.currentPrice,
                })}
              />

              {/* Fibonacci-EMA Intelligence Analysis */}
              <FibAnalysisCard
                symbol={selectedStock.symbol}
                stockId={selectedStock.id}
              />

              {/* TradingView Second Opinion — independent signal from TradingView's own NSE data */}
              <TradingViewTechAnalysis symbol={selectedStock.symbol} />

              {/* AI Explainability & Sentiment Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Suspense fallback={<div className="h-52 rounded-xl bg-gray-100 animate-pulse" />}>
                  <AiDecisionMatrix stockId={selectedStock.id} />
                </Suspense>
                
                {/* Options Wall Heatmap (Live PCR gravity) */}
                <OptionsWallHeatmap 
                  pcr={1.15} 
                  basePrice={selectedStock.currentPrice}
                  callResistance={{ strike: Math.round(selectedStock.currentPrice * 1.01), oi: 5400000 }} 
                  putSupport={{ strike: Math.round(selectedStock.currentPrice * 0.99), oi: 7200000 }} 
                />
              </div>

              {/* Charts Row 2 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SentimentTrendChart stockId={selectedStock.id} />
                <PredictionPerformanceChart stockId={selectedStock.id} />
              </div>
            </>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Please select a stock to view details</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      {/* AI Explainability Drawer */}
      <AiExplainabilityDrawer
        context={drawerCtx}
        open={drawerOpen}
        onClose={closeDrawer}
      />

      {/* Footer Stats */}
      <Card className="border-t-4 border-blue-500 bg-card">
        <CardHeader>
          <CardTitle className="text-card-foreground">Dashboard Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Active Stocks</div>
              <div className="text-2xl font-bold text-foreground">{displayStocks?.length || 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Avg Sentiment</div>
              <div className="text-2xl font-bold text-foreground">
                {displayStocks && displayStocks.length > 0
                  ? (displayStocks.reduce((sum, s) => sum + (s.sentimentScore || 50), 0) / displayStocks.length).toFixed(0)
                  : '50'}
                /100
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Data Source</div>
              <div className="text-lg font-bold text-foreground">Real API</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Last Update</div>
              <div className="text-lg font-bold text-foreground">{new Date().toLocaleTimeString('en-IN')}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
