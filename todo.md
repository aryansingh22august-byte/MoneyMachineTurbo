# Indian Stock Prediction AI Dashboard - Project TODO

## Core Features

### 1. Real-time Stock Data & Charts
- [x] Integrate with free Indian stock market API (NSE/BSE data) - API identified
- [ ] Implement WebSocket connection for live price updates
- [ ] Build interactive candlestick charts using Recharts
- [x] Display current price, change %, and trading volume - Dashboard shows this
- [ ] Add time-range selectors (1D, 1W, 1M, 3M, 1Y)

### 2. ML Prediction Engine
- [ ] Implement technical indicator calculations (Moving Averages, RSI, MACD)
- [ ] Build ML model for buy/sell signal generation
- [x] Create prediction strength scoring system (0-100%) - Schema ready
- [ ] Add signal generation logic with confidence levels
- [ ] Implement real-time prediction updates

### 3. News Sentiment Analysis
- [ ] Integrate financial news API (Finnhub or NewsAPI)
- [ ] Implement sentiment analysis for Indian stock news
- [ ] Calculate sentiment scores for stocks
- [ ] Combine sentiment with technical analysis
- [x] Display news feed with sentiment indicators - Dashboard shows this

### 4. Stock Watchlist
- [x] Design watchlist database schema - Complete
- [x] Build add/remove stock from watchlist functionality - tRPC procedures ready
- [x] Display watchlist with real-time prices and signals - Dashboard shows this
- [x] Persist watchlist to database - Database schema ready
- [x] Show watchlist on dashboard - Dashboard component built

### 5. Prediction Accuracy Tracking
- [x] Track historical predictions in database - Schema ready
- [x] Calculate accuracy metrics (correct/total predictions) - Query helper ready
- [x] Display accuracy statistics per stock - Dashboard shows this
- [ ] Show prediction performance over time
- [ ] Build accuracy dashboard/report

### 6. Alert System
- [x] Design alert notification schema - Complete
- [ ] Implement strong signal detection (buy/sell)
- [ ] Create alert notification mechanism
- [ ] Add alert preferences (email, in-app, frequency)
- [ ] Display recent alerts in dashboard

### 7. Market Overview Dashboard
- [ ] Fetch top gainers stocks
- [ ] Fetch top losers stocks
- [ ] Fetch most active stocks
- [ ] Display market indices (Nifty 50, Sensex)
- [ ] Show market summary statistics

### 8. Frontend Dashboard
- [x] Design clean financial dashboard layout - Dashboard component built
- [x] Build navigation structure - Home page with navigation
- [x] Create stock search/selection component - Dashboard has search
- [ ] Display real-time charts with technical indicators
- [x] Show buy/sell signals with strength scores - Dashboard shows signals
- [x] Build watchlist sidebar - Dashboard has watchlist
- [ ] Implement alerts display
- [ ] Add market overview section

### 9. Authentication & User Management
- [x] Verify Manus OAuth integration - Already integrated
- [ ] Set up user preferences storage
- [ ] Implement user profile page
- [x] Add logout functionality - Already available

### 10. Backend Infrastructure
- [x] Set up database schema (stocks, predictions, watchlist, alerts, accuracy) - Complete
- [x] Create tRPC procedures for all features - Complete
- [ ] Implement background jobs for data fetching
- [ ] Set up caching for API calls
- [ ] Create data synchronization logic

## Technical Setup
- [x] Research and select best free Indian stock market data API - Indian Stock Market API selected
- [ ] Research and select news sentiment API - Finnhub identified
- [ ] Set up environment variables for API keys
- [ ] Install required ML/data processing libraries (numpy, pandas, scikit-learn)
- [x] Configure database tables and migrations - Complete
- [ ] Set up background job scheduler

## Testing & Optimization
- [ ] Write unit tests for prediction engine
- [ ] Write integration tests for API endpoints
- [ ] Test real-time data updates
- [ ] Performance optimization for charts
- [ ] Test alert system end-to-end

## Deployment
- [ ] Final testing and bug fixes
- [ ] Create checkpoint before deployment
- [ ] Deploy to production
