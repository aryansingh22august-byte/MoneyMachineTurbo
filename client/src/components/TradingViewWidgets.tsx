/**
 * TradingViewWidgets.tsx
 *
 * Free TradingView embed widgets — no API key, no account required.
 *
 * 1. TradingViewLiveChart  — full professional chart iframe (their real-time NSE data)
 * 2. TradingViewTechAnalysis — Technical Analysis "Second Opinion" widget
 *    Shows their own computed BUY/SELL/NEUTRAL rating across oscillators + MAs
 */

import { useEffect, useRef } from 'react';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert our internal symbol (e.g. "ADANIGREEN" / "ADANIGREEN.NS") to NSE:SYMBOL format */
function toTVSymbol(symbol: string): string {
  const clean = symbol.replace(/\.NS$/i, '').toUpperCase();
  return `NSE:${clean}`;
}

// ── 1. Full Live Chart Widget ──────────────────────────────────────────────────

interface TradingViewLiveChartProps {
  symbol: string;
  /** px height of the chart container — defaults to 500 */
  height?: number;
}

export function TradingViewLiveChart({ symbol, height = 500 }: TradingViewLiveChartProps) {
  const tvSymbol = toTVSymbol(symbol);

  // Build the widget URL with dark theme, NSE data, no toolbar clutter
  const src = `https://www.tradingview.com/widgetembed/?symbol=${tvSymbol}&interval=D&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=0d0d0d&studies=[]&hideideas=1&theme=dark&style=1&timezone=Asia%2FKolkata&locale=en&utm_source=moneymachine`;

  return (
    <div
      className="w-full rounded-xl overflow-hidden border border-gray-800 bg-[#0d0d0d]"
      style={{ height }}
    >
      <iframe
        src={src}
        title={`TradingView Live Chart — ${tvSymbol}`}
        width="100%"
        height="100%"
        frameBorder="0"
        allowFullScreen
        allow="clipboard-write"
        style={{ display: 'block' }}
      />
    </div>
  );
}

// ── 2. Technical Analysis "Second Opinion" Widget ──────────────────────────────

interface TradingViewTechAnalysisProps {
  symbol: string;
}

/**
 * Renders TradingView's Technical Analysis widget as a React component.
 * Uses their script-injection approach (not iframe) for tighter visual integration.
 * Shows oscillator + MA summary: STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL
 */
export function TradingViewTechAnalysis({ symbol }: TradingViewTechAnalysisProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = toTVSymbol(symbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous widget when symbol changes
    container.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    container.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      interval: '1D',
      width: '100%',
      isTransparent: true,
      height: 400,
      symbol: tvSymbol,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: 'en',
      colorTheme: 'dark',
    });
    container.appendChild(script);

    return () => {
      if (container) container.innerHTML = '';
    };
  }, [tvSymbol]);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#0a0a0a]">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          {/* TradingView logo mark */}
          <svg width="18" height="18" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 28H0L14 0H28L14 28Z" fill="#2962FF"/>
            <path d="M28 28H22L28 14H34L28 28Z" fill="#2962FF"/>
          </svg>
          <span className="text-sm font-bold text-white tracking-tight">TradingView</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Second Opinion</span>
        </div>
        <span className="text-[10px] text-gray-600 font-mono">{tvSymbol}</span>
      </div>

      {/* Widget mount point */}
      <div
        ref={containerRef}
        className="tradingview-widget-container w-full"
        style={{ minHeight: 400 }}
      />

      {/* Disclosure footer */}
      <div className="px-4 py-2 border-t border-gray-800/40 flex items-center gap-2">
        <svg width="12" height="12" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 28H0L14 0H28L14 28Z" fill="#2962FF" opacity="0.5"/>
        </svg>
        <span className="text-[10px] text-gray-600">
          Powered by{' '}
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-400 transition-colors"
          >
            TradingView
          </a>
          {' '}· Independent signal, computed from NSE live data
        </span>
      </div>
    </div>
  );
}
