"""
FastAPI server for Python ML predictions — production-ready for Railway
Key features:
  - Models persist to /app/models volume so restarts never lose trained state
  - On startup: loads all saved models from disk
  - On /predict: auto-trains from provided data if no model exists yet
  - Background task at startup: auto-fetches Yahoo Finance data and trains all
    Nifty 50 + Nifty Next 50 stocks so predictions are ready from the first request
  - Weekly scheduled retrain to keep models current
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
from contextlib import asynccontextmanager
import pandas as pd
import numpy as np
from advanced_predictor import AdvancedStockPredictor, SignalType, MODEL_DIR
import logging
import json
import os
import asyncio
import time
import threading

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── Kronos Foundation Model Integration ───────────────────────────────────────
#
# Opt-in via KRONOS_ENABLED=true.
#
# This defaults to OFF deliberately. `einops` and `tqdm` were missing from
# requirements.txt, so the import below always raised and Kronos silently never
# ran. Now that those deps are declared, leaving it on by default would flip a
# dormant code path on during a routine deploy: it downloads two models at
# startup (minutes) and adds transformer inference to every /predict call, on
# CPU, for ~120 symbols per sync cycle. Turn it on once you have measured that
# latency against the Node client's 30s timeout.
import torch

KRONOS_ENABLED = os.environ.get("KRONOS_ENABLED", "false").strip().lower() in ("1", "true", "yes")

try:
    from model.kronos import KronosTokenizer, Kronos, KronosPredictor
    KRONOS_IMPORTABLE = True
except ImportError as e:
    logger.warning(f"Kronos module or dependencies not found: {e}")
    KRONOS_IMPORTABLE = False

KRONOS_AVAILABLE = KRONOS_ENABLED and KRONOS_IMPORTABLE

kronos_tokenizer = None
kronos_model = None
kronos_predictor = None

def load_kronos():
    global kronos_tokenizer, kronos_model, kronos_predictor
    if not KRONOS_ENABLED:
        logger.info("[Startup] Kronos disabled (set KRONOS_ENABLED=true to enable).")
        return
    if not KRONOS_IMPORTABLE:
        logger.warning("[Startup] KRONOS_ENABLED=true but the module failed to import — skipping.")
        return
    try:
        logger.info("[Startup] Loading Kronos-small foundation model... (This may take a few minutes)")
        kronos_tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
        kronos_model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
        kronos_predictor = KronosPredictor(kronos_model, kronos_tokenizer, max_context=512)
        logger.info("[Startup] Kronos-small foundation model loaded successfully.")
    except Exception as e:
        logger.error(f"[Startup] Failed to load Kronos: {e}")

# ── In-memory model registry with LRU eviction (Audit #15) ───────────────────
MAX_MODELS_IN_MEMORY = 50  # Evict least-recently-used when this limit is exceeded
predictors_dict: Dict[str, AdvancedStockPredictor] = {}
_model_access_times: Dict[str, float] = {}  # stock_key -> last access time
_training_lock = threading.Lock()

# Nifty 50 + Nifty Next 50 — same list as Node.js DEFAULT_STOCKS
NSE_UNIVERSE = [
    "TCS.NS","INFY.NS","HCLTECH.NS","WIPRO.NS","TECHM.NS",
    "HDFCBANK.NS","ICICIBANK.NS","SBIN.NS","AXISBANK.NS","KOTAKBANK.NS",
    "BAJFINANCE.NS","BAJAJFINSV.NS","HDFCLIFE.NS","SBILIFE.NS","ICICIGI.NS",
    "RELIANCE.NS","ONGC.NS","BPCL.NS","NTPC.NS","POWERGRID.NS","COALINDIA.NS",
    "BHARTIARTL.NS","MARUTI.NS","TATAMOTORS.NS","BAJAJ-AUTO.NS","HEROMOTOCO.NS",
    "EICHERMOT.NS","M&M.NS","HINDUNILVR.NS","ITC.NS","NESTLEIND.NS",
    "BRITANNIA.NS","TATACONSUM.NS","SUNPHARMA.NS","DRREDDY.NS","DIVISLAB.NS",
    "CIPLA.NS","APOLLOHOSP.NS","TATASTEEL.NS","JSWSTEEL.NS","HINDALCO.NS",
    "ULTRACEMCO.NS","GRASIM.NS","LT.NS","TITAN.NS","ASIANPAINT.NS",
    "ADANIPORTS.NS","ADANIENT.NS","UPL.NS","INDUSINDBK.NS",
    # Nifty Next 50
    "ABB.NS","ADANIGREEN.NS","AMBUJACEM.NS","DLF.NS","SIEMENS.NS",
    "AUROPHARMA.NS","LUPIN.NS","TORNTPHARM.NS","ZYDUSLIFE.NS",
    "BANKBARODA.NS","CANBK.NS","PNB.NS","IDFCFIRSTB.NS","CHOLAFIN.NS",
    "MUTHOOTFIN.NS","RECLTD.NS","COLPAL.NS","DABUR.NS","GODREJCP.NS",
    "MARICO.NS","BERGEPAINT.NS","HAVELLS.NS","PIDILITIND.NS","TRENT.NS",
    "VOLTAS.NS","SAIL.NS","JINDALSTEL.NS","VEDL.NS","NMDC.NS","HINDZINC.NS",
    "NAUKRI.NS","OFSS.NS","IOC.NS","IGL.NS","TATAPOWER.NS","ATGL.NS","MGL.NS",
    "PIIND.NS","SRF.NS","CONCOR.NS","IRCTC.NS","INDHOTEL.NS","ZOMATO.NS",
    "HAL.NS","BEL.NS","BEML.NS","LICI.NS","INDUSTOWER.NS","RENUKA.NS",
]


def _make_stock_key(stock_id: int, symbol: str) -> str:
    # Ignore stock_id for the key to avoid 0 vs real DB ID mismatches.
    # Symbol is unique enough (e.g., 'TCS.NS').
    return symbol


def _evict_lru_if_needed():
    """Evict least-recently-used models when cache exceeds MAX_MODELS_IN_MEMORY.
    Must be called while holding _training_lock."""
    if len(predictors_dict) <= MAX_MODELS_IN_MEMORY:
        return
    # Sort by access time, evict the oldest
    sorted_keys = sorted(_model_access_times.keys(), key=lambda k: _model_access_times.get(k, 0))
    evict_count = len(predictors_dict) - MAX_MODELS_IN_MEMORY + 5  # evict 5 extra for headroom
    for key in sorted_keys[:evict_count]:
        predictors_dict.pop(key, None)
        _model_access_times.pop(key, None)
    logger.info(f"[LRU] Evicted {evict_count} models — {len(predictors_dict)} remain in memory")


def _load_all_saved_models() -> int:
    """Load every .pkl from MODEL_DIR into predictors_dict. Called once at startup."""
    if not os.path.isdir(MODEL_DIR):
        logger.info(f"[Startup] Model directory {MODEL_DIR} not found — starting fresh.")
        return 0

    count = 0
    for fname in os.listdir(MODEL_DIR):
        if not fname.endswith(".pkl"):
            continue
        stock_key = fname[:-4]  # strip .pkl
        predictor = AdvancedStockPredictor()
        if predictor.load(stock_key):
            predictors_dict[stock_key] = predictor
            count += 1

    logger.info(f"[Startup] Loaded {count} saved models from {MODEL_DIR}.")
    return count


def _fetch_and_train_symbol(symbol: str, stock_id: int = 0) -> bool:
    """
    Fetch 1 year of daily data from Yahoo Finance and train a model.
    Implements exponential backoff on rate-limit errors (429 / Too Many Requests).
    Returns True on success. Runs in background — never blocks the API.
    """
    import yfinance as yf

    stock_key = _make_stock_key(stock_id, symbol)
    if stock_key in predictors_dict and predictors_dict[stock_key].model is not None:
        _model_access_times[stock_key] = time.time()
        return True

    MAX_RETRIES = 4
    BASE_DELAY  = 15  # seconds — first retry after 15s

    for attempt in range(MAX_RETRIES):
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="60d", interval="15m")
            if hist is None or len(hist) < 65:
                logger.warning(
                    f"[AutoTrain] Insufficient intraday data for {symbol} "
                    f"({len(hist) if hist is not None else 0} rows)"
                )
                return False

            df = hist.reset_index()
            df.columns = [c.lower() for c in df.columns]
            df = df.rename(columns={"datetime": "timestamp", "date": "timestamp"})[
                ["timestamp", "open", "high", "low", "close", "volume"]
            ]
            df["timestamp"] = pd.to_datetime(df["timestamp"])

            predictor = AdvancedStockPredictor()
            result = predictor.train_ensemble_model(df)
            if result["success"]:
                predictor.save(stock_key)
                with _training_lock:
                    _evict_lru_if_needed()
                    predictors_dict[stock_key] = predictor
                    _model_access_times[stock_key] = time.time()
                logger.info(f"[AutoTrain] {symbol} trained — accuracy={result['accuracy']:.3f}")
                return True
            else:
                logger.warning(f"[AutoTrain] {symbol} training failed: {result.get('error')}")
                return False

        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "too many requests" in err_str or "rate limit" in err_str or "429" in err_str

            if is_rate_limit and attempt < MAX_RETRIES - 1:
                wait = BASE_DELAY * (2 ** attempt)  # 15s, 30s, 60s, 120s
                logger.warning(
                    f"[AutoTrain] {symbol} rate limited — backing off {wait}s "
                    f"(attempt {attempt + 1}/{MAX_RETRIES})"
                )
                time.sleep(wait)
                continue  # retry
            else:
                logger.error(f"[AutoTrain] {symbol}: {e}")
                return False

    return False


async def _background_auto_train():
    """
    Background asyncio task: train all NSE_UNIVERSE stocks without models yet.
    Uses adaptive inter-request delays to stay within Yahoo Finance rate limits:
      - Normal mode: 3s between stocks (safe for single container)
      - After a rate-limit hit: escalates to 30s and cools down gradually
    """
    import asyncio

    # Initial startup delay — let Railway settle and avoid burst on rapid redeploys
    await asyncio.sleep(5.0)

    while True:
        missing = [s for s in NSE_UNIVERSE
                   if _make_stock_key(0, s) not in predictors_dict]

        if not missing:
            logger.info("[AutoTrain] All stocks have models — skipping training pass.")
            await asyncio.sleep(7 * 24 * 60 * 60)
            continue

        logger.info(f"[AutoTrain] Starting background training for {len(missing)} stocks...")
        trained = 0
        consecutive_failures = 0

        for symbol in missing:
            # Adaptive delay: the more consecutive failures, the longer we wait
            if consecutive_failures >= 3:
                # We are being rate-limited hard — back off 60 seconds before continuing
                logger.warning(
                    f"[AutoTrain] {consecutive_failures} consecutive failures — "
                    f"cooling down 60s before next stock..."
                )
                await asyncio.sleep(60.0)
                consecutive_failures = 0  # reset after cooldown
            else:
                # Normal healthy delay between stocks (gives event loop time too)
                await asyncio.sleep(5.0)

            success = await asyncio.get_event_loop().run_in_executor(
                None, _fetch_and_train_symbol, symbol, 0
            )

            if success:
                trained += 1
                consecutive_failures = 0
            else:
                consecutive_failures += 1

        logger.info(f"[AutoTrain] Batch complete — {trained}/{len(missing)} trained.")

        # Sleep ~1 week, then retrain everything to keep models current
        await asyncio.sleep(7 * 24 * 60 * 60)


# ── Lifespan: startup + shutdown ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    
    # Load Kronos Foundation Model
    load_kronos()
    
    # Load persisted models before accepting requests
    loaded = _load_all_saved_models()
    logger.info(f"[Startup] {loaded} legacy models ready. Starting background trainer...")

    # Run as asyncio task so Uvicorn can interleave healthcheck processing
    asyncio.create_task(_background_auto_train())

    yield  # App runs here

    logger.info("[Shutdown] ML service stopping.")


# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Stock Prediction ML API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health endpoint ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    """
    Railway healthcheck endpoint. Always returns 200 immediately — even while
    background training is in progress. The training loop is non-blocking.
    """
    trained_count = len(predictors_dict)
    return {
        "status": "ok",
        "models_loaded": trained_count,
        "training_in_progress": trained_count < len(NSE_UNIVERSE),
    }


# ── Pydantic models ───────────────────────────────────────────────────────────
class StockDataPoint(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class TrainingRequest(BaseModel):
    stock_id: int
    symbol: str
    historical_data: List[StockDataPoint]
    sentiment_score: Optional[int] = 50


class PredictionRequest(BaseModel):
    stock_id: int
    symbol: str
    latest_data: List[StockDataPoint]
    sentiment_score: Optional[int] = 50
    market_pcr: Optional[float] = 1.0
    technical_indicators: Optional[Dict] = None


class TrainingResponse(BaseModel):
    success: bool
    stock_id: int
    symbol: str
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    error: Optional[str] = None


class PredictionResponse(BaseModel):
    signal: str
    confidence: float
    technical_score: int
    sentiment_score: int
    predicted_price: float
    reasoning: str
    stock_id: int
    symbol: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def _request_to_df(data_points: List[StockDataPoint]) -> pd.DataFrame:
    df = pd.DataFrame([d.dict() for d in data_points])
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


# Kronos acts as a second opinion alongside the per-symbol ensemble rather than
# replacing it, so its influence is expressed as a confidence adjustment.
KRONOS_AGREEMENT_BONUS = 10.0
KRONOS_CONFLICT_PENALTY = 20.0
KRONOS_ONLY_CONFIDENCE = 55.0
# Signal deadband around the forecast, as a fraction of last price.
KRONOS_SIGNAL_BAND = 0.005


def _infer_candle_delta(timestamps: pd.Series) -> pd.Timedelta:
    """
    Median spacing between candles.

    The forecast horizon must match the bar size. This was hardcoded to one day
    while the Node backend sends 15-minute bars, so Kronos was asked to project
    96 bars ahead and its output was then compared against the last 15-minute
    close as though it were the next bar.
    """
    if len(timestamps) < 2:
        return pd.Timedelta(days=1)
    diffs = timestamps.sort_values().diff().dropna()
    diffs = diffs[diffs > pd.Timedelta(0)]
    if diffs.empty:
        return pd.Timedelta(days=1)
    return diffs.median()


def _run_kronos_forecast(df: pd.DataFrame, symbol: str) -> Optional[Dict]:
    """Next-candle forecast from the Kronos foundation model, or None."""
    if kronos_predictor is None:
        return None
    try:
        k_df = df.copy()
        # Kronos expects turnover in `amount`. Filling it with 0 fed the model a
        # constant, degenerate feature; close * volume is the standard proxy.
        if "amount" not in k_df.columns:
            k_df["amount"] = k_df["close"] * k_df["volume"]

        x_ts = k_df["timestamp"]
        k_df = k_df[["open", "high", "low", "close", "volume", "amount"]]

        last_time = x_ts.iloc[-1]
        y_ts = pd.Series([last_time + _infer_candle_delta(x_ts)])

        pred_df = kronos_predictor.predict(
            df=k_df,
            x_timestamp=x_ts,
            y_timestamp=y_ts,
            pred_len=1,
            T=1.0,
            top_p=0.9,
            sample_count=1,
        )

        predicted_price = float(pred_df.iloc[0]["close"])
        last_price = float(k_df.iloc[-1]["close"])
        if not np.isfinite(predicted_price) or predicted_price <= 0:
            logger.warning(f"[Kronos] {symbol}: non-finite forecast {predicted_price}, discarding")
            return None

        if predicted_price > last_price * (1 + KRONOS_SIGNAL_BAND):
            signal_value = "BUY"
        elif predicted_price < last_price * (1 - KRONOS_SIGNAL_BAND):
            signal_value = "SELL"
        else:
            signal_value = "HOLD"

        logger.info(f"[Kronos] {symbol}: {signal_value} @ {predicted_price:.2f}")
        return {
            "signal": signal_value,
            "predicted_price": predicted_price,
            "reasoning": f"Kronos next-candle forecast {predicted_price:.2f} vs last {last_price:.2f}",
        }
    except Exception as ke:
        logger.warning(f"[Kronos] {symbol}: forecast failed ({ke}); relying on ensemble")
        return None


def _get_or_train_predictor(stock_key: str, df: pd.DataFrame, sentiment_score: int) -> AdvancedStockPredictor:
    """
    Return an existing trained predictor, or train one now from provided data.
    This makes /predict self-sufficient — no separate /train call required.
    """
    with _training_lock:
        if stock_key in predictors_dict and predictors_dict[stock_key].model is not None:
            _model_access_times[stock_key] = time.time()  # Track access
            return predictors_dict[stock_key]

        # Try loading from disk first (model was evicted from memory)
        predictor = AdvancedStockPredictor()
        if predictor.load(stock_key):
            _evict_lru_if_needed()
            predictors_dict[stock_key] = predictor
            _model_access_times[stock_key] = time.time()
            logger.info(f"[Predict] Loaded {stock_key} from disk cache")
            return predictor

        # Not trained yet — train from the data the Node.js backend just sent
        logger.info(f"[Predict] No model for {stock_key} — training now from provided data...")
        predictor = AdvancedStockPredictor()
        result = predictor.train_ensemble_model(df, sentiment_score)
        if not result["success"]:
            raise ValueError(f"Auto-training failed: {result.get('error', 'unknown')}")

        predictor.save(stock_key)
        _evict_lru_if_needed()
        predictors_dict[stock_key] = predictor
        _model_access_times[stock_key] = time.time()
        logger.info(f"[Predict] Auto-trained {stock_key} — accuracy={result['accuracy']:.3f}")
        return predictor


@app.post("/train", response_model=TrainingResponse)
async def train_model(request: TrainingRequest):
    """Explicitly train/retrain the model for a specific stock."""
    try:
        df = _request_to_df(request.historical_data)
        stock_key = _make_stock_key(request.stock_id, request.symbol)

        predictor = AdvancedStockPredictor()
        result = predictor.train_ensemble_model(df, request.sentiment_score)

        if result["success"]:
            predictor.save(stock_key)
            with _training_lock:
                predictors_dict[stock_key] = predictor
            logger.info(f"[Train] {request.symbol}: accuracy={result['accuracy']:.3f}")
            return TrainingResponse(
                success=True,
                stock_id=request.stock_id,
                symbol=request.symbol,
                accuracy=result["accuracy"],
                precision=result["precision"],
                recall=result["recall"],
                f1_score=result["f1_score"],
            )
        else:
            return TrainingResponse(
                success=False,
                stock_id=request.stock_id,
                symbol=request.symbol,
                error=result.get("error"),
            )
    except Exception as e:
        logger.error(f"[Train] {request.symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict", response_model=PredictionResponse)
async def make_prediction(request: PredictionRequest):
    """
    Make a prediction. Auto-trains from provided data if no model exists yet.
    Never returns 400 for 'not trained' — it trains on-the-fly.
    """
    try:
        df = _request_to_df(request.latest_data)
        stock_key = _make_stock_key(request.stock_id, request.symbol)
        sentiment = request.sentiment_score or 50
        market_pcr = request.market_pcr or 1.0

        # ── Pillar 1: Kronos foundation-model forecast (advisory) ───────────────
        kronos_prediction = _run_kronos_forecast(df, request.symbol)

        # ── Pillar 2: per-stock CNN-LSTM ensemble (primary) ─────────────────────
        # The ensemble is the primary signal: it is trained on this specific
        # symbol and is the only path that consumes sentiment and options PCR.
        # Kronos previously short-circuited this branch entirely, so whenever the
        # foundation model loaded, every trained model went unused and every
        # response carried a hardcoded 85% confidence.
        ensemble = None
        try:
            predictor = _get_or_train_predictor(stock_key, df, sentiment)
            ensemble = predictor.predict(df, sentiment_score=sentiment, market_pcr=market_pcr)
        except Exception as ee:
            if kronos_prediction is None:
                raise  # nothing left to fall back to
            logger.warning(f"[Predict] {request.symbol}: ensemble unavailable ({ee}); using Kronos alone")

        if ensemble is not None and kronos_prediction is not None:
            signal_value = ensemble.signal.value
            tech_score = ensemble.technical_score
            agrees = kronos_prediction["signal"] == signal_value

            # Confidence is the ensemble's softmax probability, adjusted by
            # whether an independent model corroborates it.
            if agrees:
                confidence = min(95.0, ensemble.confidence + KRONOS_AGREEMENT_BONUS)
                # Both models point the same way — average the two price targets.
                predicted_price = (ensemble.predicted_price + kronos_prediction["predicted_price"]) / 2
            else:
                confidence = max(20.0, ensemble.confidence - KRONOS_CONFLICT_PENALTY)
                # Disagreement: keep the symbol-specific model's own target.
                predicted_price = ensemble.predicted_price

            reasoning = (
                f"{ensemble.reasoning} | Kronos {'confirms' if agrees else 'disagrees'} "
                f"({kronos_prediction['signal']} @ {kronos_prediction['predicted_price']:.2f})"
            )
        elif ensemble is not None:
            signal_value = ensemble.signal.value
            confidence = ensemble.confidence
            predicted_price = ensemble.predicted_price
            reasoning = ensemble.reasoning
            tech_score = ensemble.technical_score
        else:
            signal_value = kronos_prediction["signal"]
            # Deliberately modest: this is an untuned zero-shot forecast with no
            # per-symbol calibration behind it, not an 85%-confidence call.
            confidence = KRONOS_ONLY_CONFIDENCE
            predicted_price = kronos_prediction["predicted_price"]
            reasoning = kronos_prediction["reasoning"] + " (ensemble unavailable)"
            tech_score = 50

        logger.info(
            f"[Predict] {request.symbol}: {signal_value} "
            f"({confidence:.1f}% conf) [PCR: {market_pcr}] "
            f"[kronos={'yes' if kronos_prediction else 'no'} ensemble={'yes' if ensemble else 'no'}]"
        )

        # Explicit casts: several of these originate as numpy scalars
        # (np.float64 from pandas arithmetic), which Pydantic should not be
        # relied on to coerce.
        return PredictionResponse(
            signal=str(signal_value),
            confidence=float(confidence),
            technical_score=int(tech_score),
            sentiment_score=int(sentiment),
            predicted_price=float(predicted_price),
            reasoning=str(reasoning),
            stock_id=request.stock_id,
            symbol=request.symbol,
        )
    except Exception as e:
        logger.error(f"[Predict] {request.symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/model-status/{stock_id}/{symbol}")
async def get_model_status(stock_id: int, symbol: str):
    stock_key = _make_stock_key(stock_id, symbol)
    if stock_key not in predictors_dict or predictors_dict[stock_key].model is None:
        return {"stock_id": stock_id, "symbol": symbol, "trained": False, "accuracy": None}
    return {
        "stock_id": stock_id,
        "symbol": symbol,
        "trained": True,
        "accuracy": predictors_dict[stock_key].model_accuracy,
    }


@app.get("/models")
async def list_trained_models():
    trained = [
        {
            "stock_id": 0,
            "symbol": key,
            "accuracy": p.model_accuracy,
        }
        for key, p in predictors_dict.items()
        if p.model is not None
    ]
    return {"count": len(trained), "models": trained}


@app.post("/retrain-all")
async def retrain_all(background_tasks: BackgroundTasks):
    """Trigger a full retrain of all NSE_UNIVERSE stocks in the background."""
    def _do_retrain():
        logger.info("[RetainAll] Starting full retrain pass...")
        for symbol in NSE_UNIVERSE:
            stock_key = _make_stock_key(0, symbol)
            # Remove existing so _fetch_and_train_symbol re-trains
            with _training_lock:
                predictors_dict.pop(stock_key, None)
            _fetch_and_train_symbol(symbol, stock_id=0)
            time.sleep(1.5)
        logger.info("[RetainAll] Full retrain pass complete.")

    background_tasks.add_task(_do_retrain)
    return {"status": "retrain_started", "stocks": len(NSE_UNIVERSE)}


# ── Fibonacci Reliability Endpoint ────────────────────────────────────────────

# Simple in-memory cache: symbol -> (timestamp, result)
_fib_cache: Dict[str, tuple] = {}
FIB_CACHE_TTL = 24 * 3600  # 24 hours

FIB_LEVELS = [0.236, 0.382, 0.500, 0.618, 0.786]
LOOKBACK_N = 5  # fractal swing detection

class FibCandlePoint(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: int

class FibReliabilityRequest(BaseModel):
    symbol: str
    candles: List[FibCandlePoint]


def _detect_swing_highs(candles, n=LOOKBACK_N):
    highs = []
    for i in range(n, len(candles) - n):
        if all(candles[i].high >= candles[j].high for j in range(i - n, i + n + 1) if j != i):
            highs.append(i)
    return highs


def _detect_swing_lows(candles, n=LOOKBACK_N):
    lows = []
    for i in range(n, len(candles) - n):
        if all(candles[i].low <= candles[j].low for j in range(i - n, i + n + 1) if j != i):
            lows.append(i)
    return lows


def _compute_fib_reliability(candles: List[FibCandlePoint]) -> Dict:
    """
    For each Fibonacci retracement level, compute how often the price
    bounced from it historically. A 'bounce' = price came within 1% of
    the level AND reversed by at least 1% within the next 3 candles.
    """
    results = {str(r): {"bounceCount": 0, "testCount": 0} for r in FIB_LEVELS}

    swing_highs = _detect_swing_highs(candles)
    swing_lows  = _detect_swing_lows(candles)

    # For each completed high-low pair (uptrend), test retracements
    for hi_idx in swing_highs:
        for lo_idx in swing_lows:
            # Uptrend: low must come BEFORE high, and not be too far apart
            if hi_idx <= lo_idx or hi_idx - lo_idx > 60:
                continue

            swing_high = candles[hi_idx].high
            swing_low  = candles[lo_idx].low
            rng = swing_high - swing_low
            if rng <= 0:
                continue

            for ratio in FIB_LEVELS:
                fib_price = swing_high - rng * ratio
                key = str(ratio)

                # Check retracement AFTER the swing high
                for k in range(hi_idx, min(hi_idx + 5, len(candles))):
                    c = candles[k]
                    if abs(c.low - fib_price) / fib_price <= 0.01 or abs(c.high - fib_price) / fib_price <= 0.01:
                        results[key]["testCount"] += 1
                        # Check bounce: next 3 candles close 1%+ above the fib level
                        bounce = False
                        for bk in range(k + 1, min(k + 4, len(candles))):
                            if candles[bk].close > fib_price * 1.01:
                                bounce = True
                                break
                        if bounce:
                            results[key]["bounceCount"] += 1
                        break  # only count once per fib level per swing

    # Convert to bounce rates
    levels = {}
    for ratio in FIB_LEVELS:
        key = str(ratio)
        tc = results[key]["testCount"]
        bc = results[key]["bounceCount"]
        levels[f"{ratio:.3f}"] = {
            "bounceRate": round(bc / tc, 3) if tc > 0 else 0.65,  # default 65%
            "sampleSize": tc,
        }

    return levels


@app.post("/fib-reliability")
async def fib_reliability(request: FibReliabilityRequest):
    """
    Compute historical Fibonacci level bounce rates for a stock.
    Results cached 24h — subsequent calls within TTL return instantly.
    """
    symbol = request.symbol

    # Check cache
    cached = _fib_cache.get(symbol)
    if cached and (time.time() - cached[0]) < FIB_CACHE_TTL:
        logger.info(f"[FibReliability] Cache hit for {symbol}")
        return {"symbol": symbol, "levels": cached[1], "cached": True}

    if len(request.candles) < 30:
        return {"symbol": symbol, "levels": {}, "error": "Insufficient candle data"}

    try:
        levels = _compute_fib_reliability(request.candles)
        _fib_cache[symbol] = (time.time(), levels)
        logger.info(f"[FibReliability] Computed for {symbol}: {levels}")
        return {"symbol": symbol, "levels": levels, "cached": False}
    except Exception as e:
        logger.error(f"[FibReliability] Error for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
