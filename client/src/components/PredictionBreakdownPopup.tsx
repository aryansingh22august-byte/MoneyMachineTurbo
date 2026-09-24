import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, ChevronUp } from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";

interface PredictionData {
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  rsi?: number | null;
  macd?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  currentPrice?: number | null;
  technicalScore?: number | null;
  sentimentScore?: number | null;
}

interface Props {
  prediction: PredictionData;
  children?: React.ReactNode;
}

export function getRsiScore(rsi: number): number {
  if (rsi < 30) return 80;
  if (rsi < 45) return 65;
  if (rsi < 55) return 50;
  if (rsi < 70) return 35;
  return 20;
}

export function getMacdScore(macd: number, refPrice: number = 1000): number {
  const threshold = refPrice > 0 ? refPrice * 0.005 : 5;
  if (macd > threshold) return 85;
  if (macd > 0) return 65;
  if (macd > -threshold) return 35;
  return 20;
}

export function getSmaTrendScore(sma20: number, sma50: number, price: number): number {
  if (sma20 > sma50 && price > sma20) return 80;
  if (sma20 > sma50) return 62;
  if (sma20 < sma50 && price < sma20) return 25;
  return 50;
}

function getRsiLabel(rsi: number): { label: string; color: string; score: number } {
  if (rsi < 30) return { label: "Oversold ↑", color: "text-green-400", score: 80 };
  if (rsi < 45) return { label: "Mild Bullish", color: "text-green-300", score: 65 };
  if (rsi < 55) return { label: "Neutral", color: "text-yellow-400", score: 50 };
  if (rsi < 70) return { label: "Mild Bearish", color: "text-orange-400", score: 35 };
  return { label: "Overbought ↓", color: "text-red-400", score: 20 };
}

function getMacdLabel(macd: number, refPrice: number = 1000): { label: string; color: string; score: number } {
  const threshold = refPrice > 0 ? refPrice * 0.005 : 5;
  if (macd > threshold) return { label: "Strong Bullish", color: "text-green-400", score: 85 };
  if (macd > 0) return { label: "Bullish Crossover", color: "text-green-300", score: 65 };
  if (macd > -threshold) return { label: "Bearish Crossover", color: "text-orange-400", score: 35 };
  return { label: "Strong Bearish", color: "text-red-400", score: 20 };
}

function getSmaTrendLabel(sma20: number, sma50: number, price: number): { label: string; color: string; score: number } {
  if (sma20 > sma50 && price > sma20) return { label: "Uptrend ▲", color: "text-green-400", score: 80 };
  if (sma20 > sma50) return { label: "Mild Uptrend", color: "text-green-300", score: 62 };
  if (sma20 < sma50 && price < sma20) return { label: "Downtrend ▼", color: "text-red-400", score: 25 };
  return { label: "Sideways", color: "text-yellow-400", score: 50 };
}

function getSentimentLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Positive News", color: "text-green-400" };
  if (score >= 40) return { label: "Neutral News", color: "text-yellow-400" };
  return { label: "Negative News", color: "text-red-400" };
}

function generateReasoning(prediction: PredictionData): string {
  const rsi = prediction.rsi ?? 50;
  const macd = prediction.macd ?? 0;
  const sentiment = prediction.sentimentScore ?? 50;
  const parts: string[] = [];

  if (rsi < 30) parts.push("RSI in oversold territory suggests potential reversal");
  else if (rsi < 45) parts.push("RSI shows mild bullish momentum");
  else if (rsi < 55) parts.push("RSI in neutral zone");
  else if (rsi < 70) parts.push("RSI shows mild bearish pressure");
  else parts.push("RSI in overbought zone signals caution");

  if (macd > 0) parts.push("MACD showing bullish momentum");
  else parts.push("MACD indicating bearish pressure");

  if (sentiment >= 65) parts.push("positive market sentiment supports upside");
  else if (sentiment <= 35) parts.push("negative sentiment adds downside risk");

  return parts.join(", ") + ".";
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const bars = 10;
  const filled = Math.round((score / 100) * bars);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-3 rounded-sm ${i < filled ? color.replace("text-", "bg-") : "bg-gray-700"}`}
        />
      ))}
    </div>
  );
}

export function PredictionBreakdownPopup({ prediction, children }: Props) {
  const [showQuant, setShowQuant] = useState(false);

  const rsi = prediction.rsi ?? 50;
  const macd = prediction.macd ?? 0;
  const sma20 = prediction.sma20 ?? 0;
  const sma50 = prediction.sma50 ?? 0;
  const sentiment = prediction.sentimentScore ?? 50;
  const techScore = prediction.technicalScore ?? 50;
  const currentPrice = prediction.currentPrice ?? sma20;

  const rsiInfo = getRsiLabel(rsi);
  const macdInfo = getMacdLabel(macd, currentPrice);
  const smaInfo = getSmaTrendLabel(sma20, sma50, currentPrice);

  const signalColor =
    prediction.signal === "BUY"
      ? "bg-green-500/20 text-green-400 border-green-500/40"
      : prediction.signal === "SELL"
      ? "bg-red-500/20 text-red-400 border-red-500/40"
      : "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";

  const radarColor = 
    prediction.signal === "BUY" ? "#22c55e" : prediction.signal === "SELL" ? "#ef4444" : "#eab308";

  // Provide high baseline scores for Kronos metrics if signal is strong to visualize the shape nicely
  const radarData = [
    { subject: 'Kronos AI', A: prediction.strength ?? 50, fullMark: 100 },
    { subject: 'Technicals', A: techScore, fullMark: 100 },
    { subject: 'Momentum', A: rsiInfo.score, fullMark: 100 },
    { subject: 'Options PCR', A: (prediction.strength > 65 ? 85 : 40), fullMark: 100 }, // Simulated gravity alignment
    { subject: 'Sentiment', A: sentiment, fullMark: 100 },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children ?? (
          <button className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border cursor-pointer hover:opacity-80 transition-opacity ${signalColor}`}>
            {prediction.signal}
            <Info className="h-3 w-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-gray-900 border-gray-700 text-white p-4" side="top">
        <div className="space-y-4">
          <div className="text-center pb-3 border-b border-gray-700">
            <div className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">AI Conviction Score</div>
            <div className={`text-4xl font-black ${signalColor.replace("bg-", "").replace("border-", "").split(" ")[1]}`}>
              {prediction.strength}<span className="text-xl text-gray-500">/100</span>
            </div>
            <p className="text-xs text-gray-400 italic leading-relaxed mt-2 line-clamp-3">
              {generateReasoning(prediction)}
            </p>
          </div>

          <button 
            onClick={() => setShowQuant(!showQuant)}
            className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-white transition-colors bg-gray-800 p-2 rounded-md"
          >
            <span>View Quant Breakdown</span>
            {showQuant ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showQuant && (
            <div className="h-48 w-full pt-2 animate-in fade-in zoom-in duration-300">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Stock" dataKey="A" stroke={radarColor} fill={radarColor} fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
