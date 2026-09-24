/**
 * React Hook for Real-time Updates via WebSocket + SSE
 * - WebSocket connects to same server at /ws path (no separate port)
 * - Auto-reconnect on disconnect
 * - Live sentiment + prediction updates <100ms
 * - SSE for live price updates from stockDataService
 *
 * Usage:
 * const sentiment = useRealtimeSentiment(stockId);
 * const prediction = useRealtimePrediction(stockId);
 * const livePrice = useLivePriceUpdates();
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface SentimentUpdate {
  type: 'SENTIMENT_UPDATE';
  stockId: number;
  sentimentScore: number;
  sentimentLabel: string;
  newsCount: number;
  sources: string[];
  confidence: number;
  timestamp: string;
}

interface PredictionUpdate {
  type: 'PREDICTION_UPDATE';
  stockId: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  target: number;
  timestamp: string;
}

interface HeartbeatMessage {
  type: 'HEARTBEAT';
  timestamp: string;
  connectedClients: number;
}

export interface LivePriceUpdate {
  stockId: number;
  symbol: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
  predictedPrice: number;
  rsi: number;
  macd: number;
  sma20: number;
  sma50: number;
  timestamp: string;
  orderFlow?: {
    delta: number;
    pressure: 'high_buying' | 'high_selling' | 'neutral';
  };
  smc?: {
    fvgs: Array<{ top: number; bottom: number; type: 'bullish' | 'bearish' }>;
    anchoredVwap?: number;
    bias: 'bullish' | 'bearish' | 'neutral';
  };
}

type Message = SentimentUpdate | PredictionUpdate | HeartbeatMessage;

// Global WebSocket connection (reused across components)
class RealtimeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private watchdogTimer: number | null = null;
  private lastMessageTime = Date.now();
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: unknown) => void) | null = null;
  private subscribers: Map<
    number,
    Set<{
      callback: (message: Message) => void;
      types?: string[];
    }>
  > = new Map();

  constructor(url?: string) {
    // Connect to same host at /ws path — no separate port needed
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // includes port if non-standard
    this.url = url ?? `${protocol}//${host}/ws`;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        this.cleanupConnection();
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        console.log("[Realtime] Connected to WebSocket at", this.url);
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.lastMessageTime = Date.now();
        if (this.reconnectTimer) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        
        // Start Heartbeat Watchdog
        if (this.watchdogTimer) window.clearInterval(this.watchdogTimer);
        this.watchdogTimer = window.setInterval(() => {
          if (Date.now() - this.lastMessageTime > 35_000) {
            console.warn("[Realtime] Watchdog timeout: No data received for 35s. Forcing reconnect...");
            this.cleanupConnection();
            this.attemptReconnect();
          }
        }, 10_000);

        this.sendPendingSubscriptions();
        this.connectResolve?.();
        this.connectPromise = null;
        this.connectResolve = null;
        this.connectReject = null;
      };

      this.ws.onmessage = (event) => {
        try {
          this.lastMessageTime = Date.now();
          const message = JSON.parse(event.data) as Message;
          this.handleMessage(message);
        } catch (error) {
          console.error("[Realtime] Error parsing message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[Realtime] WebSocket error:", error);
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.connectReject?.(error);
          this.connectPromise = null;
          this.connectResolve = null;
          this.connectReject = null;
        }
      };

      this.ws.onclose = () => {
        console.warn("[Realtime] Disconnected, attempting reconnect...");
        this.cleanupConnection();
        this.attemptReconnect();
      };
    });

    return this.connectPromise;
  }

  private cleanupConnection() {
    if (this.watchdogTimer) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
      } catch {
        // ignore cleanup failures
      }
      this.ws = null;
    }
  }

  private sendPendingSubscriptions() {
    for (const stockId of this.subscribers.keys()) {
      this.sendMessage({ type: "SUBSCRIBE", stockId });
    }
  }

  private sendMessage(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        console.error("[Realtime] Send failed:", error);
      }
    }
  }

  private attemptReconnect() {
    if (this.reconnectTimer || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("[Realtime] Max reconnection attempts reached");
      }
      return;
    }

    this.reconnectAttempts++;
    const jitter = Math.floor(Math.random() * 400);
    const delay = Math.min(
      30000,
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + jitter
    );

    console.log(
      `[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => console.error("[Realtime] Reconnect failed:", error));
    }, delay);
  }

  private handleMessage(message: Message) {
    const stockId = "stockId" in message ? message.stockId : null;

    if (stockId !== null) {
      const subscribers = this.subscribers.get(stockId);

      if (subscribers) {
        subscribers.forEach(({ callback, types }) => {
          if (!types || types.includes(message.type)) {
            callback(message);
          }
        });
      }
    }
  }

  subscribe(
    stockId: number,
    callback: (message: Message) => void,
    types?: string[]
  ): () => void {
    if (!this.subscribers.has(stockId)) {
      this.subscribers.set(stockId, new Set());
    }

    const subscriber = { callback, types };
    this.subscribers.get(stockId)!.add(subscriber);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: "SUBSCRIBE", stockId });
    } else {
      this.connect().catch(console.error);
    }

    return () => {
      const subscribers = this.subscribers.get(stockId);

      if (subscribers) {
        subscribers.delete(subscriber);

        if (subscribers.size === 0) {
          this.subscribers.delete(stockId);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.sendMessage({ type: "UNSUBSCRIBE", stockId });
          }
        }
      }
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton client instance
let client: RealtimeClient | null = null;

function getRealtimeClient(): RealtimeClient {
  if (!client) {
    client = new RealtimeClient();
  }
  return client;
}

/**
 * Hook: Real-time Sentiment Updates
 */
export function useRealtimeSentiment(stockId: number) {
  const [sentiment, setSentiment] = useState<SentimentUpdate | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const c = getRealtimeClient();

    if (!c.isConnected()) {
      c.connect().catch(console.error);
    }

    unsubscribeRef.current = c.subscribe(
      stockId,
      (message) => {
        if (message.type === 'SENTIMENT_UPDATE') {
          setSentiment(message as SentimentUpdate);
        }
      },
      ['SENTIMENT_UPDATE']
    );

    return () => {
      unsubscribeRef.current?.();
    };
  }, [stockId]);

  return sentiment;
}

/**
 * Hook: Real-time Prediction Updates
 */
export function useRealtimePrediction(stockId: number) {
  const [prediction, setPrediction] = useState<PredictionUpdate | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const c = getRealtimeClient();

    if (!c.isConnected()) {
      c.connect().catch(console.error);
    }

    unsubscribeRef.current = c.subscribe(
      stockId,
      (message) => {
        if (message.type === 'PREDICTION_UPDATE') {
          setPrediction(message as PredictionUpdate);
        }
      },
      ['PREDICTION_UPDATE']
    );

    return () => {
      unsubscribeRef.current?.();
    };
  }, [stockId]);

  return prediction;
}

/**
 * Hook: Live Price Updates via SSE
 * Subscribes to /api/live/subscribe SSE endpoint for dashboard-wide price streaming.
 * Returns a map of stockId -> latest update, plus a "flashId" that changes when any price updates.
 */
export function useLivePriceUpdates() {
  const [prices, setPrices] = useState<Map<number, LivePriceUpdate>>(new Map());
  const [lastFlash, setLastFlash] = useState<{ stockId: number; direction: 'up' | 'down' | 'neutral'; ts: number } | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let retryTimeout: number | null = null;

    const connect = () => {
      eventSource = new EventSource('/api/live/subscribe');

      eventSource.addEventListener('liveUpdate', (event) => {
        try {
          const data = JSON.parse(event.data) as LivePriceUpdate;
          setPrices((prev) => {
            const next = new Map(prev);
            const old = next.get(data.stockId);
            next.set(data.stockId, data);

            // Determine flash direction
            if (old) {
              const direction = data.lastPrice > old.lastPrice ? 'up' : data.lastPrice < old.lastPrice ? 'down' : 'neutral';
              if (direction !== 'neutral') {
                setLastFlash({ stockId: data.stockId, direction, ts: Date.now() });
              }
            }

            return next;
          });
        } catch {
          // ignore parse errors
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        // Retry after 10s
        retryTimeout = window.setTimeout(connect, 10_000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, []);

  return { prices, lastFlash };
}

/**
 * Hook: Connection Status
 */
export function useRealtimeConnection() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const c = getRealtimeClient();
    setConnected(c.isConnected());

    if (!c.isConnected()) {
      c.connect()
        .then(() => setConnected(true))
        .catch(console.error);
    }

    const interval = setInterval(() => {
      setConnected(c.isConnected());
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return connected;
}
