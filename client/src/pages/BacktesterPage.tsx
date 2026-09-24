/**
 * Strategy Backtester Page
 * Runs the AI's RSI+MACD+SMA signal algorithm against 12 months of
 * real Yahoo Finance historical data and renders a professional tearsheet.
 */

import React, { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, TrendingDown, Target, Activity, Zap, AlertCircle,
  PlayCircle, ChevronUp, ChevronDown, BarChart2, Award, ShieldAlert,
} from 'lucide-react';

// ── NSE stock universe for the selector ─────────────────────────────────────
const NSE_STOCKS = [
  { label: 'ADANIGREEN', value: 'ADANIGREEN.NS' },
  { label: 'RELIANCE', value: 'RELIANCE.NS' },
  { label: 'TCS', value: 'TCS.NS' },
  { label: 'HDFCBANK', value: 'HDFCBANK.NS' },
  { label: 'INFY', value: 'INFY.NS' },
  { label: 'ICICIBANK', value: 'ICICIBANK.NS' },
  { label: 'SBIN', value: 'SBIN.NS' },
  { label: 'NTPC', value: 'NTPC.NS' },
  { label: 'BPCL', value: 'BPCL.NS' },
  { label: 'MGL', value: 'MGL.NS' },
  { label: 'ATGL', value: 'ATGL.NS' },
  { label: 'WIPRO', value: 'WIPRO.NS' },
  { label: 'BHARTIARTL', value: 'BHARTIARTL.NS' },
  { label: 'BAJFINANCE', value: 'BAJFINANCE.NS' },
  { label: 'MARUTI', value: 'MARUTI.NS' },
  { label: 'LT', value: 'LT.NS' },
  { label: 'AXISBANK', value: 'AXISBANK.NS' },
  { label: 'TATASTEEL', value: 'TATASTEEL.NS' },
  { label: 'POWERGRID', value: 'POWERGRID.NS' },
  { label: 'ONGC', value: 'ONGC.NS' },
];

// ── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, icon: Icon, color,
}: { label: string; value: string; sub?: string; icon: any; color: string }) {
  return (
    <Card className="bg-gray-900/60 border-gray-800 relative overflow-hidden group hover:border-gray-700 transition-colors">
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-100 transition-opacity`} />
      <CardContent className="p-4 relative z-10">
        <div className="flex items-start justify-between mb-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
          <Icon className="h-4 w-4 text-gray-600" />
        </div>
        <p className="text-2xl font-black text-white tabular-nums">{value}</p>
        {sub && <p className="text-[10px] text-gray-500 mt-1 font-medium">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Custom Tooltip for Equity Curve ─────────────────────────────────────────
function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const eq = payload[0]?.value as number;
  const isUp = eq >= 100;
  return (
    <div className="bg-gray-950 border border-gray-700 rounded-xl p-3 shadow-2xl">
      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className={`text-lg font-black ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {eq.toFixed(2)}
        </span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isUp ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
          {isUp ? '+' : ''}{(eq - 100).toFixed(2)}%
        </span>
      </div>
      {payload[0]?.payload?.signal && (
        <p className={`text-[10px] font-black mt-1 tracking-widest ${payload[0].payload.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
          ● {payload[0].payload.signal} SIGNAL
        </p>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function BacktesterPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('ADANIGREEN.NS');
  const [months, setMonths] = useState(12);
  const [runKey, setRunKey] = useState(0);

  const mutation = trpc.stock.getBacktestEquityCurve.useMutation();

  const handleRun = () => {
    mutation.mutate({ symbol: selectedSymbol, months });
    setRunKey(k => k + 1);
  };

  const result = mutation.data;
  const m = result?.metrics;

  // Determine equity chart color
  const isProfit = (m?.totalReturn ?? 0) >= 0;
  const chartColor = isProfit ? '#10b981' : '#ef4444';

  // Subsample curve for performance (max 200 points)
  const curveData = useMemo(() => {
    if (!result?.equityCurve) return [];
    const step = Math.max(1, Math.floor(result.equityCurve.length / 200));
    return result.equityCurve.filter((_, i) => i % step === 0);
  }, [result?.equityCurve]);

  return (
    <div className="min-h-screen bg-[#050508] text-white p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3">
            <BarChart2 className="h-8 w-8 text-indigo-400" />
            Strategy Backtester
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Real Yahoo Finance historical data · RSI + MACD + SMA signal engine
          </p>
        </div>
        <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 border text-xs font-bold px-3 py-1">
          REAL DATA
        </Badge>
      </div>

      {/* ── Control Bar ── */}
      <Card className="bg-gray-900/60 border-gray-800">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Stock Selector */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Stock</label>
              <select
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 transition-colors min-w-[180px]"
              >
                {NSE_STOCKS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Period */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">Period</label>
              <div className="flex gap-1">
                {[3, 6, 12].map(m => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                      months === m
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {m}M
                  </button>
                ))}
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={mutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 mt-auto"
            >
              {mutation.isPending ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Fetching Real Data...
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" />
                  Run Backtest
                </>
              )}
            </button>

            {result && (
              <div className="ml-auto text-right">
                <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Analysed</p>
                <p className="text-sm font-black text-gray-300">
                  {result.trades.length} trades over {months}M
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Loading State ── */}
      {mutation.isPending && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-900 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Low Trades Warning ── */}
      {result && result.trades.length < 3 && result.trades.length > 0 && (
        <Card className="border-yellow-900/50 bg-yellow-950/10">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
            <p className="text-yellow-400 text-sm">
              Only <strong>{result.trades.length} trade{result.trades.length !== 1 ? 's' : ''}</strong> triggered. Try <strong>12M</strong> for more meaningful results.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Error ── */}
      {mutation.isError && (
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="text-red-400 text-sm">Failed to fetch data. Yahoo Finance may be rate-limiting — try again in a few seconds.</p>
          </CardContent>
        </Card>
      )}

      {/* ── No Data ── */}
      {mutation.isSuccess && !result && (
        <Card className="border-yellow-900/50 bg-yellow-950/20">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400" />
            <p className="text-yellow-400 text-sm">Insufficient historical data for this symbol/period. Try a longer period or a different stock.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Results ── */}
      {result && m && (
        <>
          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCard
              label="Win Rate"
              value={`${m.winRate}%`}
              sub={`${m.winningTrades}W / ${m.losingTrades}L`}
              icon={Award}
              color="from-emerald-500/5 to-transparent"
            />
            <MetricCard
              label="Total Return"
              value={`${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn}%`}
              sub="vs Buy & Hold"
              icon={m.totalReturn >= 0 ? TrendingUp : TrendingDown}
              color={m.totalReturn >= 0 ? 'from-emerald-500/5 to-transparent' : 'from-red-500/5 to-transparent'}
            />
            <MetricCard
              label="Max Drawdown"
              value={`-${m.maxDrawdown}%`}
              sub="Worst peak-to-valley"
              icon={ShieldAlert}
              color="from-red-500/5 to-transparent"
            />
            <MetricCard
              label="Avg Win"
              value={`+${m.avgGain}%`}
              sub="Per winning trade"
              icon={ChevronUp}
              color="from-emerald-500/5 to-transparent"
            />
            <MetricCard
              label="Avg Loss"
              value={`-${m.avgLoss}%`}
              sub="Per losing trade"
              icon={ChevronDown}
              color="from-red-500/5 to-transparent"
            />
            <MetricCard
              label="Total Trades"
              value={`${m.totalTrades}`}
              sub={`${months} month window`}
              icon={Activity}
              color="from-indigo-500/5 to-transparent"
            />
          </div>

          {/* Equity Curve */}
          <Card className="bg-gray-900/60 border-gray-800">
            <CardHeader className="border-b border-gray-800/60 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-gray-200 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-indigo-400" />
                    Equity Curve
                  </CardTitle>
                  <CardDescription className="text-gray-500 mt-1">
                    Cumulative portfolio value starting at ₹100 (normalized) · Green = above entry
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-black tabular-nums ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isProfit ? '+' : ''}{m.totalReturn}%
                  </div>
                  <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">Final Return</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curveData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="date"
                      stroke="#475569"
                      fontSize={10}
                      tickFormatter={d => {
                        const dt = new Date(d);
                        return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="#475569"
                      fontSize={11}
                      tickFormatter={v => `${v.toFixed(0)}`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip content={<EquityTooltip />} />
                    {/* Baseline at 100 (Break-even) */}
                    <ReferenceLine
                      y={100}
                      stroke="#6366f1"
                      strokeDasharray="6 3"
                      strokeWidth={1.5}
                      label={{ value: 'ENTRY', position: 'right', fill: '#818cf8', fontSize: 9, fontWeight: 900 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke={chartColor}
                      strokeWidth={2}
                      fill="url(#equityGradient)"
                      isAnimationActive={true}
                      animationDuration={1200}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Trade Log Table */}
          <Card className="bg-gray-900/60 border-gray-800">
            <CardHeader className="border-b border-gray-800/60 pb-3">
              <CardTitle className="text-gray-200 flex items-center gap-2">
                <Target className="h-5 w-5 text-indigo-400" />
                Trade Log
              </CardTitle>
              <CardDescription className="text-gray-500">
                Every BUY→SELL pair executed by the AI signal strategy on real historical data
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 overflow-auto max-h-[400px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-950/90 backdrop-blur-sm">
                  <tr className="text-[10px] text-gray-500 font-black uppercase tracking-widest">
                    <th className="text-left py-3 px-4">#</th>
                    <th className="text-left py-3 px-2">Entry Date</th>
                    <th className="text-left py-3 px-2">Exit Date</th>
                    <th className="text-right py-3 px-2">Entry ₹</th>
                    <th className="text-right py-3 px-2">Exit ₹</th>
                    <th className="text-right py-3 px-4">Return</th>
                    <th className="text-center py-3 px-4">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {result.trades.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-gray-600 text-sm">
                        No trades were triggered in this period — try a longer timeframe.
                      </td>
                    </tr>
                  ) : (
                    result.trades.map((trade, i) => (
                      <tr
                        key={i}
                        className={`transition-colors hover:bg-gray-800/30 ${
                          trade.isWin ? 'border-l-2 border-l-emerald-500/30' : 'border-l-2 border-l-red-500/30'
                        }`}
                      >
                        <td className="py-3 px-4 text-gray-600 font-mono text-xs">{i + 1}</td>
                        <td className="py-3 px-2 text-gray-400 text-xs font-medium">{trade.entryDate}</td>
                        <td className="py-3 px-2 text-gray-400 text-xs font-medium">{trade.exitDate}</td>
                        <td className="py-3 px-2 text-right font-mono text-xs text-gray-300">
                          ₹{trade.entryPrice.toFixed(2)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs text-gray-300">
                          ₹{trade.exitPrice.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-right font-black text-sm ${trade.isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.returnPct >= 0 ? '+' : ''}{trade.returnPct}%
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-[10px] font-black px-2 py-1 rounded tracking-widest ${
                            trade.isWin ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {trade.isWin ? '✓ WIN' : '✗ LOSS'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Disclaimer */}
          <p className="text-[11px] text-gray-700 text-center italic px-4">
            Past performance does not guarantee future results. Backtested on real Yahoo Finance prices. Signal logic: RSI(14) + SMA(20/50) crossover. No brokerage or slippage modeled.
          </p>
        </>
      )}

      {/* Initial empty state */}
      {!mutation.data && !mutation.isPending && (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/10 blur-3xl rounded-full" />
            <BarChart2 className="h-16 w-16 text-indigo-500/40 relative z-10" />
          </div>
          <div>
            <h3 className="text-gray-300 font-bold text-lg mb-2">Select a stock and run the backtest</h3>
            <p className="text-gray-600 text-sm max-w-sm">
              The engine will pull <span className="text-gray-400 font-bold">real NSE historical prices</span> from Yahoo Finance
              and simulate every signal the AI would have generated.
            </p>
          </div>
          <button
            onClick={handleRun}
            className="flex items-center gap-2 px-8 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/25"
          >
            <PlayCircle className="h-5 w-5" />
            Run First Backtest
          </button>
        </div>
      )}
    </div>
  );
}
