/**
 * Real-time WebSocket Server for Live Market Data Updates
 * ───────────────────────────────────────────────────────
 * - Attaches to the SAME http.Server (shares PORT with Express)
 * - Push sentiment + prediction updates to all connected clients
 * - Replace 4-hour polling with real-time broadcasts
 * - Reduce latency from 4 hours to <100ms
 *
 * Usage:
 *   await initializeRealtimeServer(httpServer);           // attach to Express server
 *   await broadcastSentimentUpdate(stockId, sentimentData);
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface SentimentUpdate {
  type: 'SENTIMENT_UPDATE';
  stockId: number;
  sentimentScore: number;
  sentimentLabel: string;
  newsCount: number;
  sources: string[];
  confidence: number;
  timestamp: string;
}

export interface PredictionUpdate {
  type: 'PREDICTION_UPDATE';
  stockId: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  target: number;
  timestamp: string;
}

export interface HeartbeatMessage {
  type: 'HEARTBEAT';
  timestamp: string;
  connectedClients: number;
}

type BroadcastMessage = SentimentUpdate | PredictionUpdate | HeartbeatMessage;

class RealtimeUpdateServer {
  private wss: WebSocketServer | null = null;
  private clientCount = 0;
  private subscriptions: Map<number, Set<WebSocket>> = new Map();  // stockId -> set of clients
  private updateQueue: BroadcastMessage[] = [];
  private isProcessing = false;

  /**
   * Initialize WebSocket server attached to an existing HTTP server.
   * Uses the /ws path so Express routes are unaffected.
   */
  async initialize(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));

    console.log(`[WebSocket] Server attached to HTTP server at path /ws`);
    this.startHeartbeat();
    this.startUpdateProcessor();
  }

  /**
   * Handle new client connection
   */
  private handleConnection(ws: WebSocket) {
    this.clientCount++;
    console.log(`[WebSocket] Client connected (total: ${this.clientCount})`);

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        this.handleClientMessage(ws, data);
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      this.clientCount--;
      this.removeClientSubscriptions(ws);
      console.log(`[WebSocket] Client disconnected (total: ${this.clientCount})`);
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Client error:', error);
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'HEARTBEAT',
      timestamp: new Date().toISOString(),
      connectedClients: this.clientCount,
    } as HeartbeatMessage);
  }

  /**
   * Handle messages from clients
   * Clients can subscribe to specific stocks
   */
  private handleClientMessage(ws: WebSocket, data: any) {
    if (data.type === 'SUBSCRIBE') {
      const stockId = data.stockId as number;
      this.subscribeClientToStock(ws, stockId);
    } else if (data.type === 'UNSUBSCRIBE') {
      const stockId = data.stockId as number;
      this.unsubscribeClientFromStock(ws, stockId);
    } else if (data.type === 'SUBSCRIBE_ALL') {
      // Subscribe to all stocks — frontend uses this for dashboard-wide live feed
      ws.send(JSON.stringify({ type: 'SUBSCRIBED_ALL', timestamp: new Date().toISOString() }));
    }
  }

  /**
   * Subscribe client to a stock
   */
  private subscribeClientToStock(ws: WebSocket, stockId: number) {
    if (!this.subscriptions.has(stockId)) {
      this.subscriptions.set(stockId, new Set());
    }

    this.subscriptions.get(stockId)!.add(ws);
  }

  /**
   * Unsubscribe client from a stock
   */
  private unsubscribeClientFromStock(ws: WebSocket, stockId: number) {
    const subscribers = this.subscriptions.get(stockId);
    if (subscribers) {
      subscribers.delete(ws);

      if (subscribers.size === 0) {
        this.subscriptions.delete(stockId);
      }
    }
  }

  /**
   * Remove all subscriptions for a disconnected client
   */
  private removeClientSubscriptions(ws: WebSocket) {
    for (const subscribers of this.subscriptions.values()) {
      subscribers.delete(ws);
    }
  }

  /**
   * Send message to single client
   */
  private sendToClient(ws: WebSocket, message: BroadcastMessage) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('[WebSocket] Error sending to client:', error);
    }
  }

  /**
   * Broadcast to ALL connected clients (not just subscribed ones).
   * Used for dashboard-wide live price tickers.
   */
  broadcastToAll(message: BroadcastMessage) {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { /* skip dead */ }
      }
    });
  }

  /**
   * Broadcast sentiment update to subscribed clients
   * Called from sentiment service after analysis
   */
  async broadcastSentimentUpdate(
    stockId: number,
    sentiment: Omit<SentimentUpdate, 'type'>
  ) {
    const message: SentimentUpdate = {
      type: 'SENTIMENT_UPDATE',
      ...sentiment,
    };

    this.updateQueue.push(message);
  }

  /**
   * Broadcast prediction update
   */
  async broadcastPredictionUpdate(
    stockId: number,
    prediction: Omit<PredictionUpdate, 'type'>
  ) {
    const message: PredictionUpdate = {
      type: 'PREDICTION_UPDATE',
      ...prediction,
    };

    this.updateQueue.push(message);
  }

  /**
   * Process update queue and broadcast to subscribers
   * Batches updates to avoid overwhelming connections
   */
  private async startUpdateProcessor() {
    setInterval(async () => {
      if (this.isProcessing || this.updateQueue.length === 0) {
        return;
      }

      this.isProcessing = true;

      try {
        // Process up to 100 updates per batch
        const batch = this.updateQueue.splice(0, 100);

        for (const message of batch) {
          if (message.type === 'SENTIMENT_UPDATE' || message.type === 'PREDICTION_UPDATE') {
            const subscribers = this.subscriptions.get(message.stockId);

            if (subscribers && subscribers.size > 0) {
              const payload = JSON.stringify(message);
              for (const client of subscribers) {
                if (client.readyState === WebSocket.OPEN) {
                  try { client.send(payload); } catch { /* skip */ }
                }
              }
            }
          }
        }
      } finally {
        this.isProcessing = false;
      }
    }, 100);  // Process every 100ms
  }

  /**
   * Send heartbeat every 30 seconds
   * Keeps connection alive and sends stats
   */
  private startHeartbeat() {
    setInterval(() => {
      if (!this.wss) return;

      const message: HeartbeatMessage = {
        type: 'HEARTBEAT',
        timestamp: new Date().toISOString(),
        connectedClients: this.clientCount,
      };

      let sentCount = 0;

      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.sendToClient(client, message);
          sentCount++;
        }
      });

      if (sentCount > 0) {
        console.log(
          `[WebSocket] Heartbeat sent to ${sentCount}/${this.clientCount} clients`
        );
      }
    }, 30000);  // Every 30 seconds
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      connectedClients: this.clientCount,
      subscribedStocks: this.subscriptions.size,
      averageSubscribers: Array.from(this.subscriptions.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ) / Math.max(this.subscriptions.size, 1),
      queuedUpdates: this.updateQueue.length,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.wss) {
      this.wss.clients.forEach((client) => {
        client.close();
      });

      this.wss.close();
      console.log('[WebSocket] Server shut down');
    }
  }
}

// Singleton instance
let realtimeServer: RealtimeUpdateServer | null = null;

/**
 * Initialize and get singleton instance.
 * Now accepts the Express http.Server so WS shares the same port.
 */
export async function initializeRealtimeServer(httpServer: Server) {
  if (!realtimeServer) {
    realtimeServer = new RealtimeUpdateServer();
    await realtimeServer.initialize(httpServer);
  }

  return realtimeServer;
}

/**
 * Get singleton instance
 */
export function getRealtimeServer(): RealtimeUpdateServer {
  if (!realtimeServer) {
    throw new Error('Realtime server not initialized');
  }

  return realtimeServer;
}

/**
 * Broadcast sentiment update to all subscribed clients
 */
export async function broadcastSentimentUpdate(
  stockId: number,
  sentiment: Omit<SentimentUpdate, 'type'>
) {
  const server = getRealtimeServer();
  await server.broadcastSentimentUpdate(stockId, sentiment);
}

/**
 * Broadcast prediction update
 */
export async function broadcastPredictionUpdate(
  stockId: number,
  prediction: Omit<PredictionUpdate, 'type'>
) {
  const server = getRealtimeServer();
  await server.broadcastPredictionUpdate(stockId, prediction);
}

/**
 * Broadcast to ALL connected clients (dashboard-wide price tickers)
 */
export function broadcastToAllClients(message: BroadcastMessage) {
  if (!realtimeServer) return;
  realtimeServer.broadcastToAll(message);
}

/**
 * Get server stats
 */
export function getRealtimeStats() {
  const server = getRealtimeServer();
  return server.getStats();
}
