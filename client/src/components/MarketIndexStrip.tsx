import React from 'react';
import { trpc } from '@/lib/trpc';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MarketIndexStrip() {
  // Poll every 30 seconds to keep indices fresh
  const { data: indices, isLoading } = trpc.stock.getMarketIndices.useQuery(undefined, {
    refetchInterval: 30000, 
    refetchOnWindowFocus: true,
  });

  if (isLoading || !indices) {
    return (
      <div className="w-full h-8 bg-[#050505] border-b border-[#1f2937] flex items-center px-4 animate-pulse">
        <div className="flex gap-8">
          <div className="h-3 w-24 bg-gray-800 rounded"></div>
          <div className="h-3 w-24 bg-gray-800 rounded"></div>
          <div className="h-3 w-24 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  const formatNum = (num: number, isPercent = false) => {
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + (isPercent ? '%' : '');
  };

  const IndexItem = ({ 
    label, 
    data 
  }: { 
    label: string, 
    data: { price: number, change: number, changePercent: number } 
  }) => {
    const isPositive = data.change >= 0;
    const isVix = label.includes('VIX');
    
    // For VIX, green means down (good for market), red means up (bad for market)
    // Wait, VIX usually is shown in green if it's down because it means less fear.
    // Or we just stick to standard: green = positive number, red = negative number.
    // Let's stick to standard math coloring: positive = green, negative = red.
    const colorClass = isPositive ? 'text-emerald-400' : 'text-rose-400';
    const Icon = isPositive ? TrendingUp : TrendingDown;

    return (
      <div className="flex items-center gap-2 text-[11px] font-mono whitespace-nowrap">
        <span className="font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        <span className="text-gray-100 font-bold">{formatNum(data.price)}</span>
        <div className={cn("flex items-center ml-1", colorClass)}>
          {data.change !== 0 && <Icon className="w-3 h-3 mr-0.5" />}
          <span>
            {isPositive ? '+' : ''}{formatNum(data.change)} 
            <span className="opacity-80 ml-1">({isPositive ? '+' : ''}{formatNum(data.changePercent, true)})</span>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-8 bg-[#0a0a0a] border-b border-[#1f2937] flex items-center px-4 overflow-hidden shadow-sm relative z-50 shrink-0">
      <div className="flex items-center gap-2 text-cyan-500 mr-6">
        <Activity className="w-3 h-3 animate-pulse" />
        <span className="text-[10px] uppercase font-bold tracking-widest opacity-80">Live Markets</span>
      </div>
      
      <div className="flex gap-8 items-center">
        <IndexItem label="Nifty 50" data={indices.nifty50} />
        <div className="w-px h-3 bg-gray-800"></div>
        <IndexItem label="Bank Nifty" data={indices.bankNifty} />
        <div className="w-px h-3 bg-gray-800"></div>
        <IndexItem label="India VIX" data={indices.vix} />
      </div>

      {/* Decorative gradient fade at the edge */}
      <div className="absolute right-0 top-0 w-16 h-full bg-gradient-to-l from-[#0a0a0a] to-transparent pointer-events-none"></div>
    </div>
  );
}
