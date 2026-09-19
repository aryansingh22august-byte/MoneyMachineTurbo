# MoneyMachineTurbo 📈

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Railway](https://img.shields.io/badge/Deploy-Railway-purple.svg)](https://railway.app/)

> **AI-powered Indian stock market analytics dashboard** — real-time data, ML predictions, swarm intelligence, and paper trading. Built for NSE/BSE with production-grade architecture.

---

## 🎯 Overview

MoneyMachineTurbo is a full-stack platform for Indian equity research and algorithmic trading. It combines real-time market data, technical analysis, news sentiment, and machine learning predictions into a unified dashboard — with a unique **swarm intelligence engine** powered by 30 autonomous AI agents.

**Built for:** NSE (National Stock Exchange) & BSE (Bombay Stock Exchange)

---

## ✨ Features

### 📊 Real-Time Market Data
- **Upstox WebSocket** integration for live NSE ticks (15-min intervals)
- **Yahoo Finance** fallback for OHLCV history (no API key required)
- 100+ Nifty 50 + Next 50 symbols pre-configured

### 🤖 ML Predictions
- **Ensemble models** per symbol (LightGBM + XGBoost + CatBoost + meta-learner)
- **Auto-retraining** weekly on 60 days of 15-min intraday data
- **Kronos foundation model** (optional) for transformer-based forecasts
- Technical features: RSI, MACD, SMA 20/50, Bollinger Bands, ATR, volume profile

### 📰 News Sentiment
- Finnhub + NewsAPI integration
- Rule-based sentiment scoring (0–100) tuned for Indian market context
- 24-hour rolling average for stability

### 🐜 Swarm Intelligence (MiroFish)
- **30 autonomous agents** with distinct personas (momentum, mean-reversion, macro, sentiment, etc.)
- Multi-round debate → consensus report with BUY/SELL/HOLD per stock
- LLM-powered (Groq) with deterministic fallback

### 💼 Paper Trading
- Virtual wallet (₹1,000 starting capital)
- AI-driven bot with configurable risk (stop-loss, target, position sizing)
- P&L tracking, trade reasoning, scalp mode

### 📈 Technical Analysis
- **Smart Money Concepts (SMC)**: order blocks, fair value gaps, liquidity sweeps
- **Fibonacci Agent**: auto levels, confluence scoring
- Interactive charts via `lightweight-charts` + Recharts

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Frontend (React 19)                           │
│  client/src/pages/ProductionDashboard.tsx  ← Main UI                    │
│  shadcn/ui + Tailwind + TanStack Query + wouter                         │
├─────────────────────────────────────────────────────────────────────────┤
│                          Backend (Node.js + Express)                     │
│  server/_core/index.ts  ← Entry point                                    │
│  tRPC router (server/routers.ts) with 12 sub-routers                    │
│  WebSocket (realtimeUpdateServer.ts) for live updates                   │
│  Drizzle ORM + PostgreSQL (TiDB Cloud / local)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                       Python ML Service (FastAPI)                        │
│  server/ml/ml_api.py on port 5000                                        │
│  AdvancedStockPredictor + Kronos Foundation Model (optional)            │
│  Background auto-training on Nifty 50 + Next 50                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Service Communication
```
Frontend (3000) ──tRPC──▶ Node API (3000) ──HTTP──▶ Python ML (5000)
       │                    │
       └── WebSocket (8080) │
                            └── Upstox WebSocket ──▶ NSE Live Feed
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Vite, shadcn/ui, Tailwind CSS, TanStack Query, wouter |
| **Backend** | Node.js, Express, tRPC, Drizzle ORM, PostgreSQL, Server-Sent Events |
| **ML Service** | Python 3.11, FastAPI, LightGBM, XGBoost, CatBoost, scikit-learn, Kronos (optional) |
| **Real-time** | Upstox WebSocket (protobuf), Yahoo Finance REST, custom WS server |
| **Auth** | Manus OAuth + site-wide password gate (cookie-based sessions) |
| **Deploy** | Docker Compose, Railway, Render, Fly.io compatible |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL 16+ (or Docker)
- pnpm 10+

### 1. Clone & Install
```bash
git clone https://github.com/aryansingh22august-byte/MoneyMachineTurbo.git
cd MoneyMachineTurbo
pnpm install
```

### 2. Environment Setup
```bash
cp .env.example .env
# Edit .env with your values (see Optional API Keys below)
```

### 3. Database
```bash
# Local PostgreSQL via Docker
docker compose up -d db

# Push schema
pnpm run db:push
```

### 4. Development
```bash
# Terminal 1: Node.js app (includes Vite dev server)
pnpm run dev

# Terminal 2: Python ML service (optional, for predictions)
cd server/ml
pip install -r requirements.txt
python ml_api.py
```

Visit `http://localhost:3000` — you should see the dashboard.

---

## 🔑 Optional API Keys (Enhanced Features)

| Service | Feature | Free Tier | Get Key |
|---------|---------|-----------|---------|
| **Alpha Vantage** | Extended fundamentals | 25 req/day | [alphavantage.co](https://www.alphavantage.co/support/#api-key) |
| **Groq** | LLM swarm reports | 14,400 req/day | [console.groq.com](https://console.groq.com/keys) |
| **Upstox** | Real-time NSE WebSocket | Requires broker account | [upstox.com/developer](https://upstox.com/developer) |
| **Finnhub** | News sentiment | 60 req/min | [finnhub.io](https://finnhub.io/register) |
| **NewsAPI** | Additional news | 100 req/day | [newsapi.org](https://newsapi.org/register) |

> **All core features work without keys.** The platform degrades gracefully:
> - Swarm → deterministic fallback report
> - Upstox → Yahoo Finance OHLCV
> - ML → trains on Yahoo Finance data (free)

---

## 📸 Screenshots

> **Add your screenshots here!** Place images in `docs/screenshots/` and reference them:

```markdown
### Dashboard Overview
![Dashboard](docs/screenshots/dashboard.png)

### Swarm Intelligence Report
![Swarm](docs/screenshots/swarm-report.png)

### Paper Trading P&L
![Paper Trading](docs/screenshots/paper-trading.png)

### Technical Analysis (SMC + Fibonacci)
![Technical](docs/screenshots/technical-analysis.png)
```

---

## 📁 Project Structure

```
MoneyMachineTurbo/
├── client/                      # React frontend
│   ├── src/
│   │   ├── components/          # 50+ shadcn/ui components
│   │   ├── pages/ProductionDashboard.tsx
│   │   ├── hooks/               # useRealtimeUpdates, useStockData, etc.
│   │   └── lib/trpc.ts          # tRPC client
├── server/                      # Node.js backend
│   ├── _core/                   # 30+ core services
│   │   ├── stockDataService.ts      # Yahoo Finance + Upstox
│   │   ├── newsSentimentService.ts  # Finnhub/NewsAPI
│   │   ├── miroFishBridge.ts        # Swarm intelligence bridge
│   │   ├── mlServiceClient.ts       # Python ML client
│   │   ├── upstoxStreamer.ts        # WebSocket feed
│   │   ├── realtimeUpdateServer.ts  # WS server
│   │   ├── paperBotService.ts       # Autonomous paper trading
│   │   ├── smcEngine.ts             # Smart Money Concepts
│   │   └── fibonacciAgent.ts        # Fibonacci analysis
│   ├── ml/                      # Python ML service
│   │   ├── ml_api.py                # FastAPI server
│   │   ├── advanced_predictor.py    # Ensemble models
│   │   └── scalper_model.py         # Scalping model
│   ├── routers.ts               # tRPC root router (12 sub-routers)
│   └── db.ts                    # Drizzle + all DB queries
├── shared/                      # Shared types/constants
├── drizzle/                     # Schema + migrations
├── docker-compose.yml           # Local dev stack
├── docker-compose.local.yml.example  # Template with placeholders
└── railway.toml                 # Railway deploy config
```

---

## 🧪 Testing

```bash
# Type-check
pnpm run check

# Lint & format
pnpm run format

# Unit tests
pnpm run test

# Python ML tests
cd server/ml && pytest
```

---

## 🚢 Deployment

### Docker Compose (Local/VM)
```bash
cp docker-compose.local.yml.example docker-compose.local.yml
# Edit docker-compose.local.yml with your values
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

### Railway (Recommended)
1. Fork this repo
2. Create Railway project → "Deploy from GitHub"
3. Add PostgreSQL plugin
4. Set environment variables (see `.env.example`)
5. For ML service: set **Root Directory = `server/ml`**
6. Deploy both services

### Render / Fly.io
- Similar to Railway — use `docker-compose.yml` as reference
- Ensure `ML_API_URL` points to the Python service's internal URL

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** with conventional commits: `feat: add amazing feature`
4. **Push** to your fork: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

### Code Standards
- TypeScript strict mode, ESLint + Prettier
- Python: Ruff + mypy
- Conventional Commits
- PRs require: type-check pass, tests pass, no lint errors

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## ⚠️ Disclaimer

**This software is for educational and informational purposes only.**
- Not financial advice
- Always conduct your own research before making investment decisions
- Past performance does not guarantee future results
- Paper trading ≠ real trading (no slippage, liquidity, or psychological factors)

---

## 🙏 Acknowledgments

- **Yahoo Finance** — free OHLCV data
- **Upstox** — WebSocket market data API
- **Finnhub / NewsAPI** — financial news
- **Groq** — fast LLM inference for swarm
- **Kronos (NeoQuasar)** — foundation model for time-series
- **shadcn/ui** — beautiful accessible components
- **Drizzle ORM** — type-safe SQL

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/aryansingh22august-byte/MoneyMachineTurbo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/aryansingh22august-byte/MoneyMachineTurbo/discussions)
- **Security**: See [SECURITY.md](SECURITY.md)

---

**Built with ❤️ for Indian stock market enthusiasts by [Aryan Singh](https://github.com/aryansingh22august-byte)**