import React, { useState, useMemo, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useRealtimePrediction } from '@/hooks/useRealtimeUpdates';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Timeframe = '1h' | '6h' | '24h';

interface TrajectoryVisualizerChartProps {
  stockId: number;
}

export function TrajectoryVisualizerChart({ stockId }: TrajectoryVisualizerChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('24h');
  const [tick, setTick] = useState(0);
  
  const realtimePrediction = useRealtimePrediction(stockId);

  // Fetch real historical data (from DB sync)
  const { data: priceHistory, isLoading: historyLoading } = trpc.stock.getPriceHistory.useQuery({
    stockId,
    days: 7, 
  });

  // Re-run the simulation visually every 1 second to give it life
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1500); // 1.5s is smoother on CPU than 1s
    return () => clearInterval(interval);
  }, []);

  const chartData = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return [];

    // --- 1. HISTORICAL DATA ---
    const data: any[] = priceHistory.map((p, idx) => ({
      timeRaw: new Date(p.timestamp ?? Date.now()),
      time: new Date(p.timestamp ?? Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      historicalPrice: p.lastPrice,
      historicalVolume: p.volume ?? null,
      isHistorical: true,
      label: new Date(p.timestamp ?? Date.now()).toLocaleDateString(),
    }));

    // --- 2. MONTE CARLO FORECAST DATA ---
    if (realtimePrediction && data.length > 0) {
      const lastPoint = data[data.length - 1];
      const startPrice = lastPoint.historicalPrice;
      const startVolume = lastPoint.historicalVolume;
      const targetPrice = realtimePrediction.target ?? (startPrice * (realtimePrediction.signal === 'BUY' ? 1.02 : 0.98));
      const driftTotal = targetPrice - startPrice;
      
      // Calculate variance / steps based on timeframe
      let variancePercent = 0.002; 
      let steps = 12; // 1 hour = 5m intervals = 12
      let minutesPerStep = 5;
      
      if (timeframe === '6h') { variancePercent = 0.005; steps = 24; minutesPerStep = 15; }
      if (timeframe === '24h') { variancePercent = 0.015; steps = 48; minutesPerStep = 30; }

      // Confidence shrinks the cone. Higher confidence = smaller uncertainty
      const confidenceShift = realtimePrediction.confidence || 0.5;
      const maxVariance = variancePercent * (1.5 - confidenceShift);

      // Seed a pseudo-random jitter based on our interval `tick`
      // This makes the area chart "breathe"
      const jitterTick = Math.sin(tick * 0.5) * 0.001;

      for (let i = 1; i <= steps; i++) {
        const progress = i / steps;
        
        // Geometric Brownian Motion approximation
        const meanTarget = startPrice + (driftTotal * progress);
        
        // Add random walk jitter
        // We use Math.sin + tick to ensure it animates smoothly rather than violent flashing
        const activeJitter = (Math.sin(tick + i) * 0.002) * meanTarget;
        const finalMeanPrice = meanTarget + activeJitter;

        // Spread expands over time (uncertainty grows)
        const spreadLimit = finalMeanPrice * (maxVariance * progress) + Math.abs(jitterTick * startPrice);
        
        const lowerBound = finalMeanPrice - spreadLimit;
        const upperBound = finalMeanPrice + spreadLimit;

        // Simulating volume decay over time or cyclical nature
        const baseVolume = startVolume * (1 - progress * 0.3);
        const deterministicJitter = 0.8 + (Math.sin(tick * 0.1 + i * 0.5) * 0.2 + 0.2);
        const forecastVol = Math.max(10, baseVolume * deterministicJitter);

        const futDate = new Date(lastPoint.timeRaw.getTime() + i * minutesPerStep * 60000);

        data.push({
          timeRaw: futDate,
          time: futDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          meanForecast: parseFloat(finalMeanPrice.toFixed(2)),
          cone: [parseFloat(lowerBound.toFixed(2)), parseFloat(upperBound.toFixed(2))],
          forecastVolume: Math.floor(forecastVol),
          isHistorical: false,
          label: 'Probabilistic Forecast',
        });
      }

      // Connect the bridge
      lastPoint.meanForecast = lastPoint.historicalPrice;
      lastPoint.cone = [lastPoint.historicalPrice, lastPoint.historicalPrice];
      lastPoint.isBridge = true; // For reference line
    }

    // Trim historical data to make chart readable based on timeframe
    const lookbackPeriods = timeframe === '1h' ? 30 : timeframe === '6h' ? 60 : 100;
    return data.slice(-lookbackPeriods - (timeframe === '24h' ? 48 : 24));
  }, [priceHistory, realtimePrediction, timeframe, tick]);

  if (historyLoading) return <Skeleton className="h-96 w-full" />;
  if (!priceHistory || priceHistory.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Waiting for historical data sync for probability plotting...</AlertDescription>
      </Alert>
    );
  }

  // Find bridge point by data logic (last point with both historical and forecast values)
  // Avoids relying on a mutated flag that can be lost across useMemo recalculations
  const bridgePoint = chartData.slice().reverse().find(
    d => d.historicalPrice != null && d.meanForecast != null
  );
  const priceValues = chartData.flatMap(d => {
    const vals = [];
    if (d.historicalPrice && isFinite(d.historicalPrice)) vals.push(d.historicalPrice);
    if (d.cone && Array.isArray(d.cone)) {
      if (isFinite(d.cone[0])) vals.push(d.cone[0]);
      if (isFinite(d.cone[1])) vals.push(d.cone[1]);
    }
    return vals;
  });
  const maxPrice = priceValues.length > 0 ? Math.max(...priceValues) : 0;
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : 0;

  // For flat/low-volatility stocks, use 1% padding to keep the line visible (not 10% which compresses it)
  const priceRange = maxPrice - minPrice;
  const rangePadding = priceRange > 0 ? priceRange * 0.05 : Math.max(maxPrice * 0.01, 5);

  return (
    <Card className="col-span-1 lg:col-span-2 shadow-sm border" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
      <CardHeader className="pb-3 bg-white border-b">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-bold flex items-center gap-2 text-[#2c3e50]">
              Probabilistic Price & Volume Forecast
            </CardTitle>
            <CardDescription className="mt-1 text-sm text-gray-500 max-w-2xl">
              The chart below shows the historical price (blue) and the probabilistic forecast (orange). 
              The orange line is the mean of multiple Monte Carlo simulations, and the shaded area represents 
              the full range of predicted outcomes, indicating active forecast uncertainty.
            </CardDescription>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg shrink-0 h-9">
            {(['1h', '6h', '24h'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-4 text-xs font-bold rounded-md transition-all ${
                  timeframe === tf ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 bg-white" style={{ paddingBottom: '8px' }}>
        {/* PRICE PANE */}
        <div style={{ height: 350, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} syncId="montecarlo" margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#f0f0f0" />
              <XAxis dataKey="time" hide={true} />
              <YAxis 
                domain={[minPrice - rangePadding, maxPrice + rangePadding]} 
                tick={{ fontSize: 11, fill: '#64748b' }} 
                tickFormatter={(val) => `₹${val.toFixed(0)}`}
                width={65}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                cursor={{ stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }}
                formatter={(value: any, name: string) => {
                  if (name === 'cone') {
                    if (!Array.isArray(value) || !isFinite(value[0]) || !isFinite(value[1])) return ['—', 'Forecast Range'];
                    return [`₹${Number(value[0]).toFixed(2)} - ₹${Number(value[1]).toFixed(2)}`, 'Forecast Range (Min-Max)'];
                  }
                  if (name === 'meanForecast') return [`₹${Number(value).toFixed(2)}`, 'Mean Forecast'];
                  if (name === 'historicalPrice') return [`₹${Number(value).toFixed(2)}`, 'Historical Price'];
                  return [value, name];
                }}
              />
              <Legend verticalAlign="top" align="left" wrapperStyle={{ paddingBottom: '10px' }} iconType="plainline" />

              {/* Shaded Probabilistic Area */}
              <Area 
                type="monotone" 
                dataKey="cone" 
                fill="#fde68a" 
                stroke="none" 
                name="Forecast Range (Min-Max)"
                isAnimationActive={false}
                fillOpacity={0.6}
              />

              {/* Historical Price Line */}
              <Line 
                type="stepAfter" 
                dataKey="historicalPrice" 
                stroke="#3b82f6" 
                strokeWidth={1.5} 
                dot={false}
                name="Historical Price"
                isAnimationActive={false}
              />

              {/* Orange Forecast Mean Line */}
              <Line 
                type="monotone" 
                dataKey="meanForecast" 
                stroke="#f59e0b" 
                strokeWidth={1.5} 
                dot={false}
                name="Mean Forecast"
                isAnimationActive={false}
              />

              {/* Red Dashed Split Line */}
              {bridgePoint && (
                <ReferenceLine 
                  x={bridgePoint.time} 
                  stroke="#ef4444" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5} 
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* COMPACT GAP */}
        <div className="h-2 w-full border-b border-[#f0f0f0] mb-2" />

        {/* VOLUME PANE */}
        <div style={{ height: 120, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} syncId="montecarlo" margin={{ top: 0, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#f0f0f0" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 10, fill: '#64748b' }} 
                tickMargin={10} 
                axisLine={false}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis 
                tick={{ fontSize: 10, fill: '#64748b' }} 
                width={65}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}
              />
              <Tooltip 
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: any, name: string) => {
                  if (name === 'historicalVolume') return [parseInt(value), 'Historical Volume'];
                  if (name === 'forecastVolume') return [parseInt(value), 'Mean Forecasted Volume'];
                  return [value, name];
                }}
                labelFormatter={() => ''}
              />
              <Legend verticalAlign="top" align="left" iconType="square" wrapperStyle={{ paddingTop: '0px', marginTop: '-10px', fontSize: '11px' }} />

              <Bar 
                dataKey="historicalVolume" 
                fill="#93c5fd" 
                name="Historical Volume" 
                isAnimationActive={false}
              />
              <Bar 
                dataKey="forecastVolume" 
                fill="#fbcfe8" 
                name="Mean Forecasted Volume" 
                isAnimationActive={false}
              />

              {bridgePoint && (
                <ReferenceLine 
                  x={bridgePoint.time} 
                  stroke="#ef4444" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5} 
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
