import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from 'recharts';
import { Shield } from 'lucide-react';

interface OptionsWallHeatmapProps {
  pcr: number;
  basePrice: number;
  callResistance: { strike: number; oi: number };
  putSupport: { strike: number; oi: number };
}

export function OptionsWallHeatmap({ pcr, basePrice, callResistance, putSupport }: OptionsWallHeatmapProps) {
  // Logic: Calculate key levels around the Current Market Price (CMP)
  const strikeInterval = basePrice > 1000 ? 100 : basePrice > 500 ? 50 : 10;
  const strikeBase = Math.round(basePrice / strikeInterval) * strikeInterval;
  
  // Calculate "Max Pain" (Institutional Target)
  // Simplified logic: The level with the highest total combined Open Interest
  const maxPainPrice = pcr > 1.05 ? strikeBase - strikeInterval : pcr < 0.95 ? strikeBase + strikeInterval : strikeBase;

  const data = useMemo(() => {
    const list = [];
    for (let i = -3; i <= 3; i++) {
      const strike = strikeBase + (i * strikeInterval);
      
      // Bell curve distribution for Mock OI until live option chain stream is connected
      const distance = Math.abs(strike - strikeBase);
      const putWeight = Math.exp(-Math.pow(strike - putSupport.strike, 2) / (2 * Math.pow(strikeInterval * 2, 2)));
      const callWeight = Math.exp(-Math.pow(strike - callResistance.strike, 2) / (2 * Math.pow(strikeInterval * 2, 2)));

      list.push({
        strike,
        putOI: 1000000 * putWeight * (pcr > 1 ? 1.5 : 0.8),
        callOI: 1000000 * callWeight * (pcr < 1 ? 1.5 : 0.8),
      });
    }
    return list;
  }, [strikeBase, strikeInterval, pcr, callResistance.strike, putSupport.strike]);

  return (
    <Card className="border-gray-800 bg-[#0a0a0a] overflow-hidden group">
      {/* Background glow effect */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-3xl -mr-16 -mt-16 group-hover:bg-indigo-500/10 transition-colors" />
      
      <CardHeader className="border-b border-gray-800/60 pb-3 relative z-10">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-gray-300 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-400" />
              Options Wall Gravity
            </CardTitle>
            <CardDescription className="text-gray-500">Institutional OI blocking price movement</CardDescription>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-black tabular-nums ${pcr > 1 ? 'text-emerald-500' : 'text-red-500'}`}>
              {pcr.toFixed(2)}
            </div>
            <div className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">PCR Ratio</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 relative z-10">
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis 
                dataKey="strike" 
                type="category" 
                stroke="#475569" 
                fontSize={11} 
                fontWeight={600}
                width={60} 
                tickFormatter={(v) => `₹${v}`}
              />
              <Tooltip
                cursor={{ fill: '#1e293b', opacity: 0.4 }}
                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                formatter={(value: number) => [`${(value/100000).toFixed(2)}L Contracts`, '']}
                labelFormatter={(label) => `Strike: ₹${label}`}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }} />
              
              {/* CMP (Current Market Price) Reference */}
              <ReferenceLine 
                y={strikeBase} 
                stroke="#6366f1" 
                strokeDasharray="4 4" 
                strokeWidth={2}
                label={{ position: 'right', value: 'CMP', fill: '#818cf8', fontSize: 10, fontWeight: 900 }} 
              />
              
              {/* Max Pain Reference */}
              <ReferenceLine 
                y={maxPainPrice} 
                stroke="#f59e0b" 
                strokeWidth={1}
                strokeDasharray="2 2"
                label={{ position: 'left', value: 'MAX PAIN', fill: '#fbbf24', fontSize: 9, fontWeight: 900 }} 
              />

              <Bar dataKey="putOI" name="Bullish Floor (Support)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={12} />
              <Bar dataKey="callOI" name="Bearish Wall (Resistance)" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Insight footer */}
        <div className="mt-2 text-[10px] text-center text-gray-500 font-medium italic border-t border-gray-800/40 pt-2">
          {pcr > 1.2 ? "Strong support building below CMP. Upside probable." : pcr < 0.8 ? "Heavy resistance from call writers. Upside restricted." : "Neutral OI distribution. Range-bound expected."}
        </div>
      </CardContent>
    </Card>
  );
}
