import React, { useMemo } from 'react';
import { useRealtimePrediction, useRealtimeSentiment } from '@/hooks/useRealtimeUpdates';
import { trpc } from '@/lib/trpc';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BrainCircuit } from 'lucide-react';

interface AiDecisionMatrixProps {
  stockId: number;
}

export function AiDecisionMatrix({ stockId }: AiDecisionMatrixProps) {
  const realtimePrediction = useRealtimePrediction(stockId);
  const realtimeSentiment = useRealtimeSentiment(stockId);
  const { data: technicals, isLoading } = trpc.stock.getTechnicalIndicators.useQuery({ stockId });

  const radarData = useMemo(() => {
    // We map real incoming stream data into bounded 0-100 values to represent "Bullish Strength" 
    // of each independent aspect.
    
    // 1. Sentiment Bullishness (0 to 100 directly)
    const sentimentBull = realtimeSentiment?.sentimentScore ?? 50;

    // 2. Trend Momentum (MACD based roughly)
    let macdBull = 50;
    if (technicals?.macd) {
      macdBull = technicals.macd > 0 ? (technicals.macd > 2 ? 90 : 70) : (technicals.macd < -2 ? 10 : 30);
    }

    // 3. Technical Strength (RSI mapping: roughly 30 is oversold=bullish, 70 is overbought=bearish)
    // Wait, if RSI is 30, it is historically oversold meaning it's a good time to BUY (Bullish = 80 weight).
    let rsiBull = 50;
    if (technicals?.rsi) {
      rsiBull = technicals.rsi < 35 ? 85 : technicals.rsi > 70 ? 15 : 50;
    }

    // 4. Volatility (ATR)
    const atrBull = technicals?.atr ? Math.min((technicals.atr / 50) * 100, 100) : 50;

    // 5. Overall Model Confidence
    const mlConfidence = (realtimePrediction?.confidence ?? 0.5) * 100;

    return [
      { subject: 'News Sentiment', A: sentimentBull, fullMark: 100, raw: `${sentimentBull.toFixed(0)}/100` },
      { subject: 'Trend Momentum', A: macdBull, fullMark: 100, raw: `MACD: ${technicals?.macd?.toFixed(2) || 'N/A'}` },
      { subject: 'Overbought/Sold', A: rsiBull, fullMark: 100, raw: `RSI: ${technicals?.rsi?.toFixed(1) || 'N/A'}` },
      { subject: 'Volatility', A: atrBull, fullMark: 100, raw: `ATR: ${(technicals as any)?.atr?.toFixed(2) || 'N/A'}` },
      { subject: 'AI Confidence', A: mlConfidence, fullMark: 100, raw: `${mlConfidence.toFixed(0)}%` },
    ];
  }, [realtimePrediction, realtimeSentiment, technicals]);

  if (isLoading) return <Skeleton className="h-80 w-full" />;

  const signalColor = realtimePrediction?.signal === 'BUY' 
    ? '#10b981' 
    : realtimePrediction?.signal === 'SELL' 
      ? '#ef4444' 
      : '#f59e0b';

  return (
    <Card className="shadow-sm border-gray-800 bg-[#0a0a0a]">
      <CardHeader className="bg-gradient-to-b from-gray-900/50 to-transparent pb-3 border-b border-gray-800/60">
        <CardTitle className="flex items-center gap-2 text-gray-300">
          <BrainCircuit className="w-5 h-5 text-indigo-400" />
          The Black Box Engine
        </CardTitle>
        <CardDescription className="text-gray-500">Visualizing exactly HOW the AI calculated its {realtimePrediction?.signal} signal</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis 
              dataKey="subject" 
              tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }} 
            />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              name="Bullish Strength"
              dataKey="A"
              stroke={signalColor}
              fill={signalColor}
              fillOpacity={0.4}
              dot={{ r: 3, fill: signalColor, strokeWidth: 1 }}
              isAnimationActive={true}
              animationDuration={800}
            />
            <Tooltip 
              wrapperStyle={{ outline: 'none' }}
              contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)', padding: '12px' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl backdrop-blur-md">
                      <p className="text-[10px] uppercase font-bold text-slate-500 mb-1 tracking-widest">{data.subject}</p>
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-black text-white">{data.raw}</div>
                        <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${data.A > 70 ? 'bg-emerald-500/20 text-emerald-400' : data.A > 40 ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                          {data.A > 70 ? 'BULLISH' : data.A > 40 ? 'NEUTRAL' : 'BEARISH'}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
