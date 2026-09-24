/**
 * UpstoxStatusButton — Premium Toggle Switch
 * ────────────────────────────────────────────
 * A premium top-right corner toggle that:
 *   ● Shows real Upstox token status (valid / expiring / expired / not linked)
 *   ● Live countdown to expiry
 *   ● One-click opens Upstox OAuth login in a NEW TAB (preserves dashboard)
 *   ● Automatically fast-polls (every 2s) after user clicks Connect, so button
 *     updates the moment the OAuth callback stores the token server-side
 *   ● Pulses green when live, amber when expiring, red when expired
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { WifiOff, RefreshCw, Zap, Clock, AlertTriangle } from "lucide-react";

type Status = "connected" | "expiring" | "expired" | "disconnected" | "loading";

function formatCountdown(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "Expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function UpstoxStatusButton() {
  // Track whether we opened the login tab — triggers fast polling
  const [awaitingLogin, setAwaitingLogin] = useState(false);
  const awaitingLoginRef = useRef(false);
  const awaitingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fast-poll (2s) while awaiting login, slow-poll otherwise
  const refetchInterval = awaitingLogin ? 2000 : 30_000;

  const { data, isLoading, refetch } = trpc.upstox.getStatus.useQuery(undefined, {
    refetchInterval,
    staleTime: 1000,
  });

  // Local countdown that ticks every second
  const [countdown, setCountdown] = useState<number | null>(null);

  // Sync countdown with server data whenever freshly fetched
  useEffect(() => {
    if (data?.expiresInSeconds != null) {
      setCountdown(data.expiresInSeconds);
    }
  }, [data?.expiresInSeconds]);

  // Tick every second
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setInterval(() => {
      setCountdown((c) => (c !== null && c > 0 ? c - 1 : c));
    }, 1000);
    return () => clearInterval(t);
  }, [countdown]);

  // Once the server reports a valid token, stop fast-polling
  useEffect(() => {
    if (data?.isValid && awaitingLoginRef.current) {
      awaitingLoginRef.current = false;
      setAwaitingLogin(false);
      if (awaitingTimer.current) clearTimeout(awaitingTimer.current);
    }
  }, [data?.isValid]);

  // Derive display status
  const status: Status = (() => {
    if (isLoading && !data) return "loading";
    if (!data?.hasToken || !data?.isValid) {
      if (data?.hasToken && !data?.isValid) return "expired";
      return "disconnected";
    }
    if (countdown !== null && countdown < 300) return "expiring";
    return "connected";
  })();

  const handleConnect = useCallback(() => {
    const loginUrl = data?.loginUrl ?? "/api/upstox/login";

    // Open OAuth in a fresh tab — user stays on dashboard
    window.open(loginUrl, "_blank", "noopener,noreferrer");

    // Start fast-polling so we detect the new token as soon as callback fires
    awaitingLoginRef.current = true;
    setAwaitingLogin(true);

    // Give up fast-polling after 3 minutes (user may have cancelled)
    if (awaitingTimer.current) clearTimeout(awaitingTimer.current);
    awaitingTimer.current = setTimeout(() => {
      awaitingLoginRef.current = false;
      setAwaitingLogin(false);
    }, 3 * 60 * 1000);
  }, [data?.loginUrl]);

  const isLive = status === "connected";
  const isClickable = status === "expired" || status === "disconnected" || status === "expiring";

  // Also expose a manual Refresh button while awaiting login
  const handleManualRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void refetch();
  }, [refetch]);

  return (
    <button
      id="upstox-status-button"
      onClick={isClickable ? handleConnect : undefined}
      disabled={!isClickable && !awaitingLogin}
      className={[
        "relative flex items-center gap-2 rounded-full transition-all duration-300 select-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 focus-visible:ring-indigo-500",
        isClickable ? "cursor-pointer active:scale-95" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={
        isClickable
          ? "Click to connect Upstox for live market data (opens new tab)"
          : isLive
          ? `Live data — token valid for ${formatCountdown(countdown)}`
          : "Checking Upstox status…"
      }
    >
      {/* Toggle Track — the main visual */}
      <div className={[
        "relative flex items-center h-9 rounded-full px-1 transition-all duration-500 border",
        isLive
          ? "bg-emerald-500/15 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
          : status === "expiring"
          ? "bg-amber-500/15 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
          : status === "expired"
          ? "bg-red-500/10 border-red-500/40"
          : awaitingLogin
          ? "bg-indigo-500/15 border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.15)]"
          : status === "loading"
          ? "bg-gray-800/60 border-gray-700/40"
          : "bg-gray-800/60 border-gray-600/30 hover:border-gray-500/50",
      ].join(" ")}>

        {/* Toggle Knob */}
        <div className={[
          "relative z-10 flex items-center justify-center h-7 w-7 rounded-full transition-all duration-500",
          isLive
            ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
            : status === "expiring"
            ? "bg-amber-500"
            : status === "expired"
            ? "bg-red-500"
            : awaitingLogin
            ? "bg-indigo-500"
            : "bg-gray-600",
        ].join(" ")}>
          {awaitingLogin ? (
            <RefreshCw className="h-3.5 w-3.5 text-white animate-spin" />
          ) : isLive ? (
            <Zap className="h-3.5 w-3.5 text-white" />
          ) : status === "expiring" ? (
            <Clock className="h-3.5 w-3.5 text-white" />
          ) : status === "expired" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-white" />
          ) : status === "loading" ? (
            <RefreshCw className="h-3.5 w-3.5 text-white animate-spin" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-white" />
          )}

          {/* Pulse ring for live state */}
          {isLive && (
            <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" style={{ animationDuration: '2s' }} />
          )}
        </div>

        {/* Labels */}
        <div className="flex flex-col ml-2 mr-3 leading-none text-left min-w-[72px]">
          <span className={[
            "text-xs font-semibold leading-tight",
            isLive ? "text-emerald-400"
              : status === "expiring" ? "text-amber-400"
              : status === "expired" ? "text-red-400"
              : awaitingLogin ? "text-indigo-400"
              : "text-gray-300",
          ].join(" ")}>
            {awaitingLogin ? "Waiting…"
              : isLive ? "LIVE DATA"
              : status === "expiring" ? "Expiring!"
              : status === "expired" ? "Expired"
              : status === "loading" ? "Checking…"
              : "Connect"}
          </span>

          {/* Sub-label: countdown or instruction */}
          {(isLive || status === "expiring") && countdown != null && (
            <span className={`text-[10px] font-medium leading-tight mt-0.5 ${
              isLive ? "text-emerald-400/60" : "text-amber-400/80"
            }`}>
              {formatCountdown(countdown)}
            </span>
          )}
          {status === "expired" && (
            <span className="text-[10px] font-medium leading-tight mt-0.5 text-red-400/70">
              Click to reconnect
            </span>
          )}
          {awaitingLogin && (
            <span className="text-[10px] font-medium leading-tight mt-0.5 text-indigo-400/70">
              Login in new tab
            </span>
          )}
          {status === "disconnected" && !awaitingLogin && (
            <span className="text-[10px] font-medium leading-tight mt-0.5 text-gray-500">
              Link Upstox →
            </span>
          )}
        </div>

        {/* Manual refresh icon — visible while awaiting login */}
        {awaitingLogin && (
          <button
            onClick={handleManualRefresh}
            className="mr-2 p-1 rounded-full hover:bg-indigo-500/20 transition-colors"
            title="Check now"
          >
            <RefreshCw className="h-3 w-3 text-indigo-400" />
          </button>
        )}
      </div>
    </button>
  );
}

export default UpstoxStatusButton;
