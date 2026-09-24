import { Response, Request } from "express";
import { SMCReport } from "./smcEngine";

interface LiveUpdatePayload {
  stockId: number;
  symbol: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  predictedPrice: number;
  rsi: number;
  macd: number;
  sma20: number;
  sma50: number;
  timestamp: string;
  smc?: SMCReport;
  orderFlow?: {
    delta: number;
    pressure: 'high_buying' | 'high_selling' | 'neutral';
  };
}

export interface FibAlertPayload {
  stockId: number;
  symbol: string;
  alertTier: 'APPROACHING' | 'AT_ZONE' | 'TRIGGERED';
  signal: 'BUY' | 'SELL' | 'HOLD';
  fibLevel: string;      // e.g. "61.8%"
  fibPrice: number;
  confluenceStrength: number; // 1-5
  candlePattern: string;
  emaPeriod: number | null;
  entryZone: [number, number] | null;
  stopLoss: number | null;
  target1: number | null;
  riskReward: number | null;
  reasoning: string;
  timestamp: string;
}

interface ClientMeta { connectedAt: number }
const clients = new Map<Response, ClientMeta>();
const SSE_CLIENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max per connection

function removeClient(res: Response) {
  if (clients.has(res)) {
    clients.delete(res);
  }
  try { res.end(); } catch { /* ignore */ }
}

// Heartbeat — purges stale connections every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [client, meta] of clients) {
    const stale = (client as any).writableEnded || (client as any).writableFinished;
    const timedOut = now - meta.connectedAt > SSE_CLIENT_TIMEOUT_MS;
    if (stale || timedOut) {
      removeClient(client);
    }
  }
}, 2 * 60 * 1000);

export function subscribeLiveUpdates(req: Request, res: Response) {
  res.writeHead(200, {
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
    "Content-Type": "text/event-stream",
  });

  res.write(`retry: 10000\n\n`);
  res.socket?.setKeepAlive(true);
  clients.set(res, { connectedAt: Date.now() });

  const cleanup = () => removeClient(res);

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

export function getActiveClientCount(): number {
  return clients.size;
}

function broadcastToClients(message: string) {
  for (const [client] of Array.from(clients)) {
    if ((client as any).writableEnded || (client as any).writableFinished) {
      removeClient(client);
      continue;
    }
    try {
      client.write(message);
    } catch (error) {
      console.warn("[SSE] Failed to write to client, removing dead connection", error);
      removeClient(client);
    }
  }
}

export function broadcastLiveUpdate(payload: LiveUpdatePayload) {
  const message = `event: liveUpdate\ndata: ${JSON.stringify(payload)}\n\n`;
  broadcastToClients(message);
}

export function broadcastHealth() {
  const payload = { status: "ok", timestamp: new Date().toISOString() };
  const message = `event: health\ndata: ${JSON.stringify(payload)}\n\n`;
  broadcastToClients(message);
}

export function broadcastFibAlert(payload: FibAlertPayload) {
  const message = `event: fibAlert\ndata: ${JSON.stringify(payload)}\n\n`;
  broadcastToClients(message);
}
