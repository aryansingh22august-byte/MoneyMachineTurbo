import React, { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Bell, AlertTriangle, Zap, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function AlertBellButton() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Poll alerts every 30 seconds
  const { data: alerts, isLoading } = trpc.alert.getRecent.useQuery({ limit: 10 }, {
    refetchInterval: 30000,
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const unreadCount = alerts?.length || 0; // For now, we just show total recent alerts as "new" until we add read receipts

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center justify-center h-9 w-9 rounded-lg border border-gray-700 bg-gray-800/60 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-gray-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-800 bg-[#0a0a0a] flex items-center justify-between">
            <h3 className="font-semibold text-white text-sm">Recent Alerts</h3>
            <span className="text-xs text-gray-500">{alerts?.length || 0} signals</span>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-gray-500 text-sm animate-pulse">Loading alerts...</div>
            ) : alerts && alerts.length > 0 ? (
              <div className="flex flex-col">
                {alerts.map((alert) => {
                  const isBuy = alert.condition?.includes('BUY');
                  const Icon = isBuy ? Zap : AlertTriangle;
                  return (
                    <div key={alert.id} className="px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <div className="flex gap-3">
                        <div className={`mt-0.5 flex items-center justify-center h-7 w-7 rounded-full shrink-0 ${isBuy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 font-medium">
                            {alert.stockSymbol}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                            {alert.message}
                          </p>
                          <p className="text-[10px] text-gray-500 mt-1.5 font-mono">
                            {alert.createdAt ? formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true }) : 'Just now'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center flex flex-col items-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500/50 mb-2" />
                <p className="text-gray-400 text-sm font-medium">No alerts yet</p>
                <p className="text-gray-600 text-xs mt-1">We'll notify you of strong signals.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
