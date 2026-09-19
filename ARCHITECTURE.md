# Architecture Documentation

## System Overview

MoneyMachineTurbo is a **three-service architecture** for Indian stock market analytics:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React 19)                                │
│  Port: 3000                                                                  │
│  client/src/pages/ProductionDashboard.tsx  ← Main UI                        │
│  shadcn/ui + Tailwind + TanStack Query + wouter                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                          Backend API (Node.js)                               │
│  Port: 3000 (HTTP) + 8080 (WebSocket)                                       │
│  server/_core/index.ts  ← Entry point                                        │
│  tRPC Router (server/routers.ts) with 12 sub-routers                        │
│  Drizzle ORM + PostgreSQL                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                       Python ML Service (FastAPI)                            │
│  Port: 5000                                                                  │
│  server/ml/ml_api.py                                                         │
│  AdvancedStockPredictor + Kronos Foundation Model (optional)                │
│  Background auto-training on Nifty 50 + Next 50                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Market Data Ingestion
```
NSE/BSE ──Upstox WebSocket──▶ upstoxStreamer.ts ──protobuf──▶ stockDataService.ts
                                    │
                                    ▼
                            realtimeUpdateServer.ts (WS broadcast)
                                    │
                                    ▼
                            Frontend (live charts, price updates)
```

### 2. Prediction Pipeline
```
Cron (15 min) ──▶ stockDataService.generateQuickPreview()
                        │
                        ▼
              Yahoo Finance (60d 15m) ──▶ Python ML (/predict)
                        │                      │
                        │                Ensemble Model
                        │                (LightGBM+XGBoost+CatBoost)
                        ▼                      ▼
              Technical Indicators      Prediction Result
              (RSI, MACD, SMA)          (signal, confidence, target)
                        │                      │
                        └──────────┬───────────┘
                                   ▼
                          Drizzle ORM → PostgreSQL
                                   │
                                   ▼
                          tRPC → Frontend
```

### 3. Sentiment Analysis
```
Cron (1 hr) ──▶ newsSentimentService.ts
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   Finnhub API                 NewsAPI
        │                           │
        └─────────────┬─────────────┘
                      ▼
            Rule-based scoring (0-100)
            Indian market context
                      │
                      ▼
            cachedSentimentService.ts (Redis/In-memory)
                      │
                      ▼
            tRPC → Frontend (sentiment badges, trends)
```

### 4. Swarm Intelligence (MiroFish)
```
Frontend Request ──▶ miroFishBridge.ts
                          │
                          ▼
                   Groq LLM (30 agents)
                   Multi-round debate
                          │
                          ▼
              Consensus Report (BUY/SELL/HOLD per stock)
                          │
                          ▼
              Parsed → swarmRouter.ts → Frontend
```

---

## Service Contracts

### tRPC Root Router (`server/routers.ts`)
```typescript
appRouter = router({
  system: systemRouter,           // health, version
  auth: authRouter,               // me, logout
  stock: stockRouter,             // prices, predictions, watchlist, alerts
  swarm: swarmRouter,             // swarm predictions, OHLCV, accuracy
  sentiment: sentimentRouter,     // news sentiment history
  prediction: predictionRouter,   // prediction history
  alert: alertRouter,             // user alerts
  ml: mlRouter,                   // model stats
  watchlist: watchlistRouter,     // user watchlist
  upstox: upstoxRouter,           // OAuth status
  fibonacci: fibonacciRouter,     // fib levels
  trading: tradingRouter,         // paper trading
  macro: macroRouter,             // macro gravity
})
```

### Python ML API (`server/ml/ml_api.py`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health + model count |
| `/predict` | POST | Single symbol prediction |
| `/predict/batch` | POST | Batch predictions |
| `/retrain` | POST | Trigger retrain |
| `/models` | GET | List trained models |
| `/models/{symbol}` | DELETE | Delete model |

---

## Database Schema (Drizzle)

### Core Tables
| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `users` | Auth + roles | `openId` (unique) |
| `stocks` | Master data (symbol, name, sector) | `symbol` (unique) |
| `stockPrices` | OHLCV + real-time ticks | `(stockId, timestamp DESC, id DESC)` |
| `predictions` | ML signals + confidence | `(stockId, timestamp DESC, id DESC)` |
| `newsSentiment` | Article sentiment (0-100) | `(stockId, publishedAt DESC)` |
| `watchlist` | User watchlists | `(userId, stockId)` |
| `alerts` | User notifications | `(userId, triggeredAt)` |
| `accuracyTracking` | Prediction verification | `(stockId, resolutionDate)` |
| `paperWallets` | Virtual trading balance | `userId` (unique) |
| `paperTrades` | Trade history | `(userId, openedAt)` |
| `botState` | Bot config per user | `userId` (unique) |

---

## Deployment Architecture

### Local (Docker Compose)
```yaml
services:
  app:        # Node.js + React
  ml-service: # Python FastAPI
  db:         # PostgreSQL 16
  # Redis optional for caching
```

### Railway (Production)
```
┌─────────────────┐     ┌─────────────────┐
│  Node Service   │────▶│  Python ML      │
│  (public)       │ tRPC│  (private)      │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  PostgreSQL     │     │  Redis (cache)  │
│  (plugin)       │     │  (optional)     │
└─────────────────┘     └─────────────────┘
```

**Key configs:**
- `railway.toml` — Node service (Dockerfile.node)
- `server/ml/railway.toml` — ML service (Root Directory = server/ml)
- Shared `PORT` env (Railway injects)
- WebSocket shares Node service port at `/ws`

---

## Security Boundaries

| Boundary | Protection |
|----------|------------|
| **Public → Node** | Site-wide password gate (ACCESS_PASSWORD) |
| **Node → ML** | Internal network only, no auth (private DNS) |
| **Node → DB** | Parameterized queries (Drizzle), SSL |
| **Upstox → Node** | OAuth 2.0, daily token expiry |
| **Frontend → Node** | tRPC + cookie-based sessions (HS256) |

---

## Scaling Considerations

| Component | Current | Scale Path |
|-----------|---------|------------|
| WebSocket | Single server | Redis PubSub + multiple WS servers |
| ML Inference | Single container | Horizontal (model sharding by symbol) |
| Database | Single PG | Read replicas, partitioning by date |
| Cron Jobs | In-process | External scheduler (Temporal, pg_cron) |

---

## Technology Decisions

| Choice | Rationale |
|--------|-----------|
| **tRPC** | End-to-end type safety, no OpenAPI sync needed |
| **Drizzle + pgTable** | Type-safe SQL, no migration drift |
| **PostgreSQL** | JSONB, arrays, window functions for analytics |
| **FastAPI + Python** | ML ecosystem (LightGBM, XGBoost, scikit-learn) |
| **Upstox WebSocket** | Official NSE real-time feed |
| **Yahoo Finance fallback** | Free, no key, 15-min delayed |
| **Kronos (optional)** | Foundation model for regime detection |
| **shadcn/ui** | Accessible, customizable, no runtime deps |