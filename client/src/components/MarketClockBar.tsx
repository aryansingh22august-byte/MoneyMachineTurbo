/**
 * MarketClockBar.tsx
 * Real-time IST clock + NSE market status + F&O expiry countdown
 * - Updates every second
 * - NSE market hours: 09:15–15:30 IST Mon–Fri
 * - Weekly expiry: every Thursday (NSE Index options)
 * - Monthly expiry: last Thursday of the month (stock options / futures)
 */

import { useState, useEffect } from 'react';
import { Clock, Calendar, TrendingUp, AlertCircle } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNow(): Date {
  return new Date();
}

type MarketPhase = 'PRE' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'WEEKEND';

function getMarketPhase(now: Date): MarketPhase {
  // During market hours (03:30 to 10:00 UTC), the UTC day matches the IST day.
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return 'WEEKEND';

  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const mins = h * 60 + m;

  const preOpen  = 3 * 60 + 30;     // 09:00 IST = 03:30 UTC
  const open     = 3 * 60 + 45;     // 09:15 IST = 03:45 UTC
  const closingS = 9 * 60 + 55;     // 15:25 IST = 09:55 UTC
  const close    = 10 * 60;         // 15:30 IST = 10:00 UTC

  if (mins < preOpen)   return 'CLOSED';
  if (mins < open)      return 'PRE';
  if (mins < closingS)  return 'OPEN';
  if (mins < close)     return 'CLOSING';
  return 'CLOSED';
}

/** Next NSE market open — 09:15 IST next weekday */
function getNextOpen(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(3, 45, 0, 0); // 09:15 IST = 03:45 UTC
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/** NSE market close — 15:30 IST today (or next weekday) */
function getMarketClose(now: Date): Date {
  const close = new Date(now);
  close.setUTCHours(10, 0, 0, 0); // 15:30 IST = 10:00 UTC
  if (close <= now) close.setUTCDate(close.getUTCDate() + 1);
  while (close.getUTCDay() === 0 || close.getUTCDay() === 6) {
    close.setUTCDate(close.getUTCDate() + 1);
  }
  return close;
}

/** Next Thursday (or today if it's Thursday and expiry not yet passed) */
function nextThursday(from: Date, skipToday = false): Date {
  const d = new Date(from);
  const dow = d.getUTCDay(); // 4=Thu
  let diff = (4 - dow + 7) % 7;
  if (diff === 0 && skipToday) diff = 7;
  if (diff === 0) {
    // It's Thursday — check if 15:30 IST has passed
    const expiryIST = new Date(d);
    expiryIST.setUTCHours(10, 0, 0, 0);
    if (from >= expiryIST) diff = 7; // expired today, next week
  }
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(10, 0, 0, 0); // 15:30 IST
  return d;
}

/** Last Thursday of the current/next month */
function lastThursdayOfMonth(from: Date): Date {
  // Try last Thursday of this month
  const candidate = new Date(from);
  const year  = candidate.getUTCFullYear();
  const month = candidate.getUTCMonth();

  // Last day of month
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const dow = lastDay.getUTCDay();
  const daysBack = (dow - 4 + 7) % 7; // days back to Thursday
  const lastThu = new Date(Date.UTC(year, month, lastDay.getUTCDate() - daysBack, 10, 0, 0));

  // If already past, use next month
  if (lastThu <= from) {
    const nm = new Date(Date.UTC(year, month + 2, 0));
    const nmd = nm.getUTCDay();
    const nb = (nmd - 4 + 7) % 7;
    return new Date(Date.UTC(year, month + 1, nm.getUTCDate() - nb, 10, 0, 0));
  }
  return lastThu;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs  = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MarketClockBar() {
  const [now, setNow] = useState(() => getNow());

  useEffect(() => {
    const id = setInterval(() => setNow(getNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase   = getMarketPhase(now);
  const weeklyExpiry  = nextThursday(now);
  const monthlyExpiry = lastThursdayOfMonth(now);
  const countdownTarget = phase === 'OPEN' || phase === 'CLOSING'
    ? getMarketClose(now)
    : getNextOpen(now);

  const isWeeklyAlsoMonthly =
    weeklyExpiry.getUTCDate()  === monthlyExpiry.getUTCDate() &&
    weeklyExpiry.getUTCMonth() === monthlyExpiry.getUTCMonth();

  const phaseConfig: Record<MarketPhase, { label: string; dot: string; text: string; bg: string }> = {
    PRE:     { label: 'PRE-MARKET', dot: 'bg-yellow-400 animate-pulse', text: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-500/20' },
    OPEN:    { label: 'MARKET OPEN', dot: 'bg-emerald-400 animate-pulse', text: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-500/20' },
    CLOSING: { label: 'CLOSING SESSION', dot: 'bg-orange-400 animate-pulse', text: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-500/20' },
    CLOSED:  { label: 'MARKET CLOSED', dot: 'bg-gray-500', text: 'text-gray-400', bg: 'bg-gray-800/40 border-gray-700/30' },
    WEEKEND: { label: 'WEEKEND', dot: 'bg-gray-600', text: 'text-gray-500', bg: 'bg-gray-800/40 border-gray-700/30' },
  };

  const pc = phaseConfig[phase];

  const timeIST = now.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const dateIST = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl border bg-[#0a0a0a] border-gray-800/60 text-xs">

      {/* ── Clock ── */}
      <div className="flex items-center gap-2 min-w-max">
        <Clock className="h-3.5 w-3.5 text-gray-500 shrink-0" />
        <div>
          <span className="font-mono font-bold text-white tracking-wider text-sm">{timeIST}</span>
          <span className="ml-2 text-gray-500">{dateIST} IST</span>
        </div>
      </div>

      <span className="text-gray-800 hidden sm:inline">│</span>

      {/* ── Market Status ── */}
      <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${pc.bg}`}>
        <span className={`h-2 w-2 rounded-full shrink-0 ${pc.dot}`} />
        <span className={`font-bold tracking-wider ${pc.text}`}>{pc.label}</span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-400 font-mono">
          {phase === 'OPEN' || phase === 'CLOSING'
            ? `Closes in ${formatCountdown(countdownTarget.getTime() - now.getTime())}`
            : phase === 'PRE'
            ? `Opens in ${formatCountdown(countdownTarget.getTime() - now.getTime())}`
            : phase === 'WEEKEND'
            ? `Opens ${formatDate(getNextOpen(now))}`
            : `Opens in ${formatCountdown(countdownTarget.getTime() - now.getTime())}`
          }
        </span>
      </div>

      <span className="text-gray-800 hidden sm:inline">│</span>

      {/* ── Weekly Expiry ── */}
      <div className="flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold leading-none">Weekly Expiry</span>
          <div className="flex items-center gap-1.5">
            <span className="text-indigo-300 font-semibold">{formatDate(weeklyExpiry)}</span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
              weeklyExpiry.getTime() - now.getTime() < 86400_000
                ? 'bg-red-500/20 text-red-400'
                : 'bg-indigo-500/10 text-indigo-400'
            }`}>
              {formatCountdown(weeklyExpiry.getTime() - now.getTime())}
            </span>
          </div>
        </div>
      </div>

      <span className="text-gray-800 hidden sm:inline">│</span>

      {/* ── Monthly Expiry ── */}
      <div className="flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <div className="flex flex-col">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold leading-none">
            Monthly Expiry{isWeeklyAlsoMonthly && <span className="ml-1 text-red-400">⚠ Same as Weekly</span>}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-amber-300 font-semibold">{formatDate(monthlyExpiry)}</span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
              monthlyExpiry.getTime() - now.getTime() < 3 * 86400_000
                ? 'bg-red-500/20 text-red-400 animate-pulse'
                : 'bg-amber-500/10 text-amber-400'
            }`}>
              {formatCountdown(monthlyExpiry.getTime() - now.getTime())}
            </span>
          </div>
        </div>
      </div>

      {/* ── Expiry same-week alert ── */}
      {isWeeklyAlsoMonthly && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30 ml-auto">
          <AlertCircle className="h-3 w-3 text-red-400" />
          <span className="text-red-400 font-bold text-[10px]">EXPIRY WEEK — Both weekly & monthly expire Thursday</span>
        </div>
      )}
    </div>
  );
}
