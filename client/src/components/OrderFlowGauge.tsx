import React from 'react';
import { Activity, ArrowUp, ArrowDown } from 'lucide-react';

interface OrderFlowGaugeProps {
  delta: number;
  pressure: 'high_buying' | 'high_selling' | 'neutral';
}

export const OrderFlowGauge: React.FC<OrderFlowGaugeProps> = ({ delta, pressure }) => {
  const isPositive = delta >= 0;
  
  // Calculate percentage for the needle (clamped between -1000 and 1000 for relative view)
  const clampedDelta = Math.min(Math.max(delta, -1000), 1000);
  const percentage = ((clampedDelta + 1000) / 2000) * 100;

  return (
    <div className="bg-[#0a0a0a] border border-gray-800 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-400" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Order Flow Delta</span>
        </div>
        <span className={`text-xs font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isPositive ? '+' : ''}{delta.toLocaleString()}
        </span>
      </div>

      {/* The Gauge */}
      <div className="relative h-2 w-full bg-gray-900 rounded-full overflow-hidden border border-gray-800">
        {/* Midpoint marker */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-700 z-10" />
        
        {/* Delta fill */}
        <div 
          className={`absolute top-0 bottom-0 transition-all duration-500 ${isPositive ? 'bg-emerald-500/40 left-1/2' : 'bg-rose-500/40 right-1/2'}`}
          style={{ width: `${Math.abs(percentage - 50)}%` }}
        />

        {/* The Needle */}
        <div 
          className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-20 transition-all duration-300"
          style={{ left: `${percentage}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="flex justify-between text-[8px] text-gray-600 font-bold uppercase">
        <span>Selling Pressure</span>
        <span className={
          pressure === 'high_buying' ? 'text-emerald-400' : 
          pressure === 'high_selling' ? 'text-rose-400' : 
          'text-gray-500'
        }>
          {pressure.replace('_', ' ')}
        </span>
        <span>Buying Pressure</span>
      </div>

      {pressure !== 'neutral' && (
        <div className={`mt-1 flex items-center gap-1 text-[10px] font-bold ${pressure === 'high_buying' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pressure === 'high_buying' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          <span>Institutional {pressure === 'high_buying' ? 'Accumulation' : 'Distribution'} Detected</span>
        </div>
      )}
    </div>
  );
};
