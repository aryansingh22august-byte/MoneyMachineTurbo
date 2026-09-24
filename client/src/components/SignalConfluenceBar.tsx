import React, { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRealtimePrediction } from '@/hooks/useRealtimeUpdates';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Target, Cpu, TrendingUp, TrendingDown, CheckCircle2, XCircle, GitBranch } from 'lucide-react';
import { toast } from 'sonner';

interface SignalConfluenceBarProps {
  stockId: number;
  symbol: string;
  currentPrice: number;
}

export function SignalConfluenceBar({ stockId, symbol, currentPrice }: SignalConfluenceBarProps) {
  const [isPlacingTrade, setIsPlacingTrade] = useState(false);

  // 1. ML Signal
  const realtimePrediction = useRealtimePrediction(stockId);
  const mlSignal = realtimePrediction?.signal ?? 'HOLD';
  const mlConfidence = realtimePrediction?.confidence ?? 0;

  // 2. Fibonacci Signal
  const { data: fibData } = trpc.fibonacci.getFibLevels.useQuery(
    { symbol: symbol.includes('.') ? symbol : `${symbol}.NS` },
    { staleTime: 60_000, enabled: !!symbol }
  );
  const fibSignal = fibData?.signal ?? 'HOLD';

  // 3. Swarm Signal
  const { data: swarmReport } = trpc.swarm.getLatestPredictions.useQuery(undefined, {
    staleTime: 60_000
  });
  
  // Find the specific stock prediction within the swarm's affected stocks
  const swarmPrediction = swarmReport?.predictions
    .flatMap((p: any) => p.affectedStocks)
    .find((s: any) => symbol.toUpperCase().includes(s.symbol.toUpperCase()));
    
  const swarmSignal = swarmPrediction?.direction === 'UP' ? 'BUY' : swarmPrediction?.direction === 'DOWN' ? 'SELL' : 'HOLD';

  // 4. SMC Market Structure (BoS / CHoCH)
  const { data: smcData } = trpc.stock.getSMCAnalysis.useQuery(
    { stockId, symbol },
    { staleTime: 30_000, enabled: !!stockId && stockId > 0 }
  );

  // 5. Live Preview (for untracked stocks from search)
  const { data: previewData } = trpc.stock.getLivePreview.useQuery(
    { symbol },
    { staleTime: 30_000, enabled: !!symbol && (!stockId || stockId < 0) }
  );

  const latestStructure = smcData?.structures?.[smcData.structures.length - 1];
  const structureSignal = latestStructure?.direction === 'bullish' ? 'BUY' : latestStructure?.direction === 'bearish' ? 'SELL' : 'HOLD';

  // 6. TradingView Rating
  const tvSignal = 'See Widget Below';

  // Compute Confluence Score
  // Use preview signal if available, else use DB signal
  const finalMlSignal = stockId && stockId > 0 ? mlSignal : (previewData?.prediction?.signal ?? 'HOLD');
  const finalMlConf = stockId && stockId > 0 ? mlConfidence : (previewData?.prediction?.strength ?? 0);
  
  const signals = [finalMlSignal, fibSignal, swarmSignal, structureSignal];
  const buyVotes = signals.filter(s => s === 'BUY').length;
  const sellVotes = signals.filter(s => s === 'SELL').length;
  const totalVotes = signals.filter(s => s !== 'HOLD').length;

  let confluenceScore = 0;
  let overallSignal = 'HOLD';

  if (buyVotes > sellVotes) {
    overallSignal = 'BUY';
    confluenceScore = Math.round((buyVotes / 4) * 100);
  } else if (sellVotes > buyVotes) {
    overallSignal = 'SELL';
    confluenceScore = Math.round((sellVotes / 4) * 100);
  } else if (totalVotes > 0) {
    overallSignal = 'MIXED';
    confluenceScore = 50;
  }

  // TRPC Mutation for Manual Override
  const placeTradeMutation = trpc.trading.placeTrade.useMutation({
    onSuccess: (data) => {
      if (!data) return;
      toast.success(`Manual ${data.type} Executed`, {
        description: `Successfully placed paper trade for ${data.quantity}x ${data.symbol} @ ₹${data.entryPrice.toFixed(2)}`,
      });
      setIsPlacingTrade(false);
    },
    onError: (error) => {
      toast.error('Trade Failed', {
        description: error.message,
      });
      setIsPlacingTrade(false);
    }
  });

  const handleManualOverride = (type: 'BUY' | 'SELL') => {
    setIsPlacingTrade(true);
    
    // Default 1% SL and 2% Target for manual trades
    const slDist = 0.01;
    const tpDist = 0.02;
    
    const stopLoss = type === 'BUY' ? currentPrice * (1 - slDist) : currentPrice * (1 + slDist);
    const targetPrice = type === 'BUY' ? currentPrice * (1 + tpDist) : currentPrice * (1 - tpDist);
    
    // Default ₹5,000 capital per manual trade
    const capitalPerTrade = 5000;
    const quantity = Math.max(1, Math.floor(capitalPerTrade / currentPrice));

    placeTradeMutation.mutate({
      stockId,
      symbol,
      type,
      entryPrice: currentPrice,
      quantity,
      stopLoss,
      targetPrice,
      mode: 'MANUAL',
      reasoning: `Manual override execution. Confluence Score: ${confluenceScore}% ${overallSignal}`
    });
  };

  return (
    <Card className="border-indigo-500/20 bg-[#0a0a0a] shadow-lg mb-6">
      <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Left: Signals Breakdown */}
        <div className="flex-1 w-full grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* AI Signal Section */}
          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <span className="text-[10px] text-indigo-400 font-bold uppercase mb-1 flex items-center gap-1">
              <Cpu className="w-3 h-3"/> AI Signal {stockId && stockId < 0 && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded ml-1">PREVIEW</span>}
            </span>
            <span className={`text-xs font-black ${finalMlSignal === 'BUY' ? 'text-emerald-400' : finalMlSignal === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>
              {finalMlSignal}
            </span>
            <div className="w-full h-1 bg-gray-800 rounded-full mt-1.5 overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${finalMlSignal === 'BUY' ? 'bg-emerald-500' : finalMlSignal === 'SELL' ? 'bg-red-500' : 'bg-gray-600'}`}
                style={{ width: `${finalMlConf}%` }}
              />
            </div>
            <span className="text-[9px] text-gray-500 font-medium mt-1">{Math.round(finalMlConf)}% Confidence</span>
          </div>

          {/* Fibonacci Section */}
          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-900/50 border border-gray-800">
            <span className="text-[10px] text-gray-500 font-bold uppercase mb-1 flex items-center gap-1"><Target className="w-3 h-3"/> Fibonacci</span>
            <span className={`text-xs font-black ${fibSignal === 'BUY' ? 'text-emerald-400' : fibSignal === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>{fibSignal}</span>
            <span className="text-[9px] text-gray-600 font-medium mt-0.5 tracking-tight truncate w-full text-center px-1" title={fibData?.nearestZone ? `Near ${(fibData.nearestZone.fibRatio * 100).toFixed(1)}% level` : 'No clear zone'}>
              {fibData?.alertTier === 'TRIGGERED' ? 'High Conviction' : fibData?.nearestZone ? `Near ${(fibData.nearestZone.fibRatio * 100).toFixed(1)}%` : 'No active zone'}
            </span>
          </div>

          {/* Swarm Section */}
          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-900/50 border border-gray-800">
            <span className="text-[10px] text-gray-500 font-bold uppercase mb-1 flex items-center gap-1"><Shield className="w-3 h-3"/> Swarm AI</span>
            <span className={`text-xs font-black ${swarmSignal === 'BUY' ? 'text-emerald-400' : swarmSignal === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>{swarmSignal}</span>
            <span className="text-[9px] text-gray-600 font-medium mt-0.5 tracking-tight truncate w-full text-center px-1">
              {swarmPrediction ? `${(swarmPrediction.confidence * 100).toFixed(0)}% Consensus` : 'No Consensus'}
            </span>
          </div>

          {/* Market Structure Section */}
          <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-900/50 border border-gray-800">
            <span className="text-[10px] text-gray-500 font-bold uppercase mb-1 flex items-center gap-1"><GitBranch className="w-3 h-3"/> Structure</span>
            <span className={`text-xs font-black ${structureSignal === 'BUY' ? 'text-emerald-400' : structureSignal === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>
              {latestStructure ? latestStructure.type : 'SIDEWAYS'}
            </span>
            <span className="text-[9px] text-gray-600 font-medium mt-0.5 tracking-tight truncate w-full text-center px-1">
              {latestStructure ? (latestStructure.direction === 'bullish' ? 'Bullish Trend' : 'Bearish Trend') : 'Consolidating'}
            </span>
          </div>
        </div>

        {/* Middle: Confluence Score */}
        <div className="px-6 py-2 flex flex-col items-center justify-center border-x border-gray-800/50">
          <span className="text-xs text-gray-400 font-semibold mb-1">CONFLUENCE</span>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-black ${overallSignal === 'BUY' ? 'text-emerald-400' : overallSignal === 'SELL' ? 'text-red-400' : 'text-yellow-400'}`}>
              {confluenceScore}%
            </span>
            {confluenceScore >= 66 ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <XCircle className="w-5 h-5 text-gray-600" />}
          </div>
        </div>

        {/* Right: Manual Override */}
        <div className="flex flex-col gap-2 shrink-0">
          <span className="text-[10px] text-gray-500 font-bold uppercase text-center">Manual Override</span>
          <div className="flex gap-2">
            <Button 
              size="sm" 
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-8 text-xs"
              onClick={() => handleManualOverride('BUY')}
              disabled={isPlacingTrade}
            >
              <TrendingUp className="w-3 h-3 mr-1" /> FORCE BUY
            </Button>
            <Button 
              size="sm" 
              variant="destructive"
              className="bg-red-600 hover:bg-red-500 text-white font-bold h-8 text-xs"
              onClick={() => handleManualOverride('SELL')}
              disabled={isPlacingTrade}
            >
              <TrendingDown className="w-3 h-3 mr-1" /> FORCE SELL
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
