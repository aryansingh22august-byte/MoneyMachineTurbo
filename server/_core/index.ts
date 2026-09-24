import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startStockSyncService } from "./stockDataService";
import { startNewsSentimentService } from "./newsSentimentService";
import { initializeCache, startBackgroundCacheRefresh, closeCache } from "./cachedSentimentService";
import { startBacktestService } from "./backtestService";
import { startAccuracyEvaluatorService, stopAccuracyEvaluatorService } from "./accuracyEvaluatorService";
import { subscribeLiveUpdates } from "./realTimeService";
import { upstoxRouter } from "./upstoxAuth";
import { stopNewsSentimentService } from "./newsSentimentService";
import { startAlertScannerService, stopAlertScannerService } from "../alertScannerService";
import cookieParser from "cookie-parser";
import { registerAccessGateRoutes, resolveAccessGateConfig } from "./accessGate";
import { assertProductionEnv } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Both checks run before anything binds a port: in production they throw when
  // secrets or DATABASE_URL are missing/malformed, so a misconfigured deploy
  // fails loudly instead of coming up with forgeable sessions, a publicly-known
  // password, or a database that silently returns nothing.
  assertProductionEnv();
  const accessGateConfig = resolveAccessGateConfig();

  const app = express();
  const server = createServer(app);

  // Healthchecks MUST be defined before any middleware
  app.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });
  app.get("/api/trpc/system.healthcheck", (_req, res) => {
    res.status(200).send("OK");
  });

  // Railway terminates TLS at its proxy: without this req.ip is the proxy's
  // address, which would collapse every client into one rate-limit bucket.
  app.set("trust proxy", 1);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());

  // Site-wide password gate. Throws at startup in production if
  // ACCESS_PASSWORD / SESSION_SECRET are missing rather than falling back to
  // hardcoded values.
  registerAccessGateRoutes(app, accessGateConfig);

  // Upstox integration routes
  app.use("/api/upstox", upstoxRouter);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.get("/api/live/subscribe", subscribeLiveUpdates);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Railway strictly requires binding to process.env.PORT exactly.
  // Dynamic port shifting causes proxy traffic to miss the server entirely.
  const port = process.env.PORT ? parseInt(process.env.PORT) : await findAvailablePort(3000);

  // Attach WebSocket server to the SAME HTTP server (shares port).
  // Railway only exposes one port — no separate WS port needed.
  const { initializeRealtimeServer } = await import("./realtimeUpdateServer");
  await initializeRealtimeServer(server);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
    console.log(`[WebSocket] Available at ws://0.0.0.0:${port}/ws`);
    console.log(`[Upstox] Please login at http://localhost:${port}/api/upstox/login to start data streams.`);
  });

  try {
    await initializeCache();
    startBackgroundCacheRefresh();
    startStockSyncService().catch((err) => console.error("[StockSync] Startup error:", err));
    startNewsSentimentService();
    startBacktestService().catch((err) => console.error("[Background] Startup error:", err));
    
    // Start Autonomous Trading Bot
    import("./paperBotService").then(mod => {
      mod.paperBotService.start();
    }).catch(err => console.error("[PaperBot] Initialization error:", err));

    // Start Alert Scanner
    startAlertScannerService();
    
    // Start Native ML Evaluator Feedback Loop
    startAccuracyEvaluatorService();

  } catch (err) {
    console.error("[Startup] Background services failed to start:", err);
  }

  // MiroFish Tier 1: Auto-seed swarm intelligence every 6h
  import("./miroFishBridge").then(({ startMiroFishAutoSeed }) => {
    startMiroFishAutoSeed();
  }).catch((err) => console.error("[MiroFish] Startup error:", err));

  // Background loop to establish Upstox WebSocket — exponential backoff on failures
  import("./upstoxStreamer").then(({ connectUpstoxStreamer, isUpstoxConnected }) => {
    let retryDelay = 5000;
    let wasConnected = false;
    const attemptConnect = () => {
      void Promise.resolve(connectUpstoxStreamer()).then(() => {
        const nowConnected = isUpstoxConnected();
        if (nowConnected) {
          wasConnected = true;
          retryDelay = 30000; // healthy — check again every 30s
        } else {
          if (wasConnected) {
            // was connected, just dropped — reconnect quickly
            retryDelay = 5000;
            wasConnected = false;
          } else {
            // still failing — back off up to 2 minutes
            retryDelay = Math.min(retryDelay * 1.5, 120_000);
          }
        }
        setTimeout(attemptConnect, retryDelay);
      }).catch(() => {
        retryDelay = Math.min(retryDelay * 1.5, 120_000);
        setTimeout(attemptConnect, retryDelay);
      });
    };
    setTimeout(attemptConnect, 5000); // first attempt 5s after boot
  });

  // Graceful shutdown — close Redis, stop intervals
  const shutdown = async (signal: string) => {
    console.log(`[Server] ${signal} received — shutting down gracefully`);
    stopNewsSentimentService();
    stopAlertScannerService();
    stopAccuracyEvaluatorService();
    await closeCache();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000); // force-exit after 10s
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT",  () => void shutdown("SIGINT"));
}

startServer().catch((err) => {
  // Exit non-zero so the orchestrator restarts / surfaces the failure instead
  // of leaving a half-started process reported as healthy.
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
