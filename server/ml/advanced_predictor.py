"""
Advanced CNN-LSTM Hybrid Prediction Engine for Indian Stock Market
Fuses PyTorch Deep Learning with Sentiment Vectors for Real-Time Trading
"""

import numpy as np
import pandas as pd
from typing import Dict, Tuple, List, Optional
from dataclasses import dataclass
from enum import Enum
import json
import os
import joblib
import logging

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

MODEL_DIR = os.environ.get("MODEL_DIR", "/app/models")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SignalType(Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"

@dataclass
class PredictionResult:
    signal: SignalType
    confidence: float
    technical_score: int
    sentiment_score: int
    predicted_price: float
    reasoning: str


# ─── Deep Learning Architecture (CNN + LSTM + Sentiment Fusion) ────────────────

class CnnLstmHybrid(nn.Module):
    def __init__(self, num_features: int, sequence_length: int, hidden_size: int = 64):
        super(CnnLstmHybrid, self).__init__()
        
        # 1D Convolution for Micro-structure feature extraction
        # Input shape: (Batch, Channels/Features, SeqLen)
        self.conv1 = nn.Conv1d(in_channels=num_features, out_channels=32, kernel_size=3, padding=1)
        self.relu1 = nn.ReLU()
        self.pool1 = nn.MaxPool1d(kernel_size=2)
        
        # LSTM for sequence processing
        # Output of pool1 has len = SeqLen // 2
        lstm_input_size = 32
        self.lstm = nn.LSTM(input_size=lstm_input_size, hidden_size=hidden_size, num_layers=2, batch_first=True, dropout=0.2)
        
        # Sentiment fusion: we concatenate the LSTM output with the sentiment scalar
        self.fc1 = nn.Linear(hidden_size + 1, 32)
        self.relu2 = nn.ReLU()
        self.dropout = nn.Dropout(0.3)
        self.fc2 = nn.Linear(32, 3) # 3 Classes: SELL (-1), HOLD (0), BUY (1)
        
    def forward(self, x, sentiment):
        # x is (Batch, SeqLen, Features). Conv1d expects (Batch, Features, SeqLen)
        x = x.transpose(1, 2)
        
        # Micro-structure extraction
        x = self.conv1(x)
        x = self.relu1(x)
        x = self.pool1(x)
        
        # Back to (Batch, SeqLen, Features) for LSTM
        x = x.transpose(1, 2)
        
        # Sequence temporal understanding
        lstm_out, (hn, cn) = self.lstm(x)
        # Take the output from the last time step
        last_out = lstm_out[:, -1, :] 
        
        # Fusion with sentiment embedding
        sentiment = sentiment.unsqueeze(1) # (Batch, 1)
        fused = torch.cat((last_out, sentiment), dim=1) # (Batch, Hidden + 1)
        
        out = self.fc1(fused)
        out = self.relu2(out)
        out = self.dropout(out)
        out = self.fc2(out)
        
        return out


class AdvancedStockPredictor:
    """
    Advanced PyTorch Deep Learning Prediction Engine
    Uses 1D-CNN + LSTM + Continuous Sentiment Fusion.
    """

    def __init__(self, sequence_length=60):
        self.scaler = StandardScaler()
        self.model = None
        self.feature_names = []
        self.model_accuracy = 0.0
        self.sequence_length = sequence_length
        
        # Use GPU memory if running on a machine with CUDA, else CPU (Railway)
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    def calculate_technical_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df = df.sort_values("timestamp").reset_index(drop=True)

        df["returns"] = df["close"].pct_change()
        df["sma_5"] = df["close"].rolling(5).mean()
        df["sma_20"] = df["close"].rolling(20).mean()
        df["sma_50"] = df["close"].rolling(50).mean()
        
        df["ema_12"] = df["close"].ewm(span=12, adjust=False).mean()
        df["ema_26"] = df["close"].ewm(span=26, adjust=False).mean()
        df["macd"] = df["ema_12"] - df["ema_26"]
        df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
        df["macd_diff"] = df["macd"] - df["macd_signal"]

        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = (-delta).clip(lower=0)
        avg_gain = gain.rolling(window=14).mean()
        avg_loss = loss.rolling(window=14).mean()
        rs = avg_gain / (avg_loss + 1e-10)
        df["rsi"] = 100 - (100 / (1 + rs))

        df["bb_middle"] = df["close"].rolling(20).mean()
        bb_std = df["close"].rolling(20).std()
        df["bb_upper"] = df["bb_middle"] + (bb_std * 2)
        df["bb_lower"] = df["bb_middle"] - (bb_std * 2)
        df["bb_position"] = (df["close"] - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-10)

        df["tr"] = np.maximum(df["high"] - df["low"], np.maximum(abs(df["high"] - df["close"].shift(1)), abs(df["low"] - df["close"].shift(1))))
        df["atr"] = df["tr"].rolling(14).mean()
        df["atr_percent"] = (df["atr"] / df["close"]) * 100

        df["volume_sma"] = df["volume"].rolling(20).mean()
        df["volume_ratio"] = df["volume"] / (df["volume_sma"] + 1e-10)
        df["roc_10"] = ((df["close"] - df["close"].shift(10)) / df["close"].shift(10)) * 100

        # ADX (Average Directional Index) - Trend Strength
        plus_dm = np.where(df["high"].diff() > df["low"].diff().abs(), df["high"].diff(), 0)
        minus_dm = np.where(df["low"].diff().abs() > df["high"].diff(), df["low"].diff().abs(), 0)
        tr = df["tr"].rolling(14).mean()
        plus_di = 100 * (pd.Series(plus_dm).rolling(14).mean() / (tr + 1e-10))
        minus_di = 100 * (pd.Series(minus_dm).rolling(14).mean() / (tr + 1e-10))
        dx = 100 * (abs(plus_di - minus_di) / (abs(plus_di + minus_di) + 1e-10))
        df["adx"] = dx.rolling(14).mean()

        # ── Pillar 2: Technical Confluence (Pro Trader Metrics) ───────────────
        
        # 1. Support and Resistance (20-period swing highs/lows)
        df['support_20'] = df['low'].rolling(window=20).min()
        df['resistance_20'] = df['high'].rolling(window=20).max()
        df['dist_to_support'] = (df['close'] - df['support_20']) / df['close'] * 100
        df['dist_to_resistance'] = (df['resistance_20'] - df['close']) / df['close'] * 100

        # 2. Institutional Volume Profile Proxy (VWAP)
        df['cum_volume'] = df['volume'].cumsum()
        df['cum_vol_price'] = (df['close'] * df['volume']).cumsum()
        df['vwap'] = df['cum_vol_price'] / (df['cum_volume'] + 1e-10)
        df['dist_to_vwap'] = (df['close'] - df['vwap']) / df['vwap'] * 100

        # 3. Fibonacci Retracement Levels (50-period swing)
        recent_low = df['low'].rolling(50).min()
        recent_high = df['high'].rolling(50).max()
        df['fib_618'] = recent_high - (recent_high - recent_low) * 0.618
        df['fib_382'] = recent_high - (recent_high - recent_low) * 0.382
        
        # How close are we to the Golden Pocket (0.618)?
        df['dist_to_fib618'] = (df['close'] - df['fib_618']).abs() / df['close'] * 100

        return df.dropna()

    def build_features(self, df: pd.DataFrame, target_sentiment: int = 50) -> Tuple[pd.DataFrame, List[str]]:
        df = self.calculate_technical_indicators(df)

        feature_columns = [
            "sma_5", "sma_20", "sma_50", "ema_12", "ema_26", 
            "macd", "macd_signal", "macd_diff", "rsi", 
            "bb_upper", "bb_lower", "bb_position", "atr_percent", 
            "volume_ratio", "roc_10", "adx",
            "dist_to_support", "dist_to_resistance", "dist_to_vwap", "dist_to_fib618"
        ]

        # Normalize price-relative features
        for col in ["sma_5", "sma_20", "sma_50", "ema_12", "ema_26", "macd", "macd_signal", "bb_upper", "bb_lower"]:
            if col in df.columns:
                df[f"{col}_norm"] = (df[col] / df["close"]) * 100
                feature_columns.append(f"{col}_norm")
                feature_columns.remove(col) 
                
        # Sentiment is NOT in the feature matrix for LSTM time steps. 
        # It is fused at the fully connected layer at the end.
        
        self.feature_names = feature_columns
        return df, feature_columns

    def build_sequences(self, data_scaled, sentiments, labels=None):
        """
        Create 3D sequence tensors for the LSTM: (Batch, SeqLen, Features).

        Sequences whose label is NaN (the unresolved tail from generate_labels)
        are skipped rather than being folded in as HOLD.
        """
        X_seq, s_seq = [], []
        y_seq = [] if labels is not None else None

        for i in range(len(data_scaled) - self.sequence_length):
            anchor = i + self.sequence_length - 1  # bar the prediction is made on
            if labels is not None:
                label = labels[anchor]
                if np.isnan(label):
                    continue
                y_seq.append(label)
            X_seq.append(data_scaled[i : i + self.sequence_length])
            s_seq.append(sentiments[anchor])

        X_tensor = torch.tensor(np.array(X_seq), dtype=torch.float32)
        s_tensor = torch.tensor(np.array(s_seq), dtype=torch.float32)

        if labels is not None:
            # Map labels from {-1, 0, 1} to {0, 1, 2} for PyTorch CrossEntropyLoss
            y_tensor = torch.tensor(np.array(y_seq), dtype=torch.long) + 1
            return X_tensor, s_tensor, y_tensor
        return X_tensor, s_tensor

    def generate_labels(self, df: pd.DataFrame, lookahead: int = 4) -> np.ndarray:
        """
        Forward-looking label for each bar. Data is 15m intraday, so a lookahead
        of 4 is roughly one hour ahead.

        Returns NaN for the final `lookahead` bars, whose outcome has not
        happened yet. They were previously left at the zero-initialised value,
        which silently mislabelled them as genuine HOLD observations and taught
        the model that the end of every series is flat.
        """
        close = df["close"].to_numpy(dtype=float)
        labels = np.full(len(df), np.nan)
        if len(close) <= lookahead:
            return labels

        current = close[:-lookahead]
        future = close[lookahead:]
        with np.errstate(divide="ignore", invalid="ignore"):
            change_percent = np.where(current != 0, (future - current) / current * 100.0, 0.0)

        resolved = np.zeros(len(current))
        resolved[change_percent > 0.5] = 1.0    # BUY
        resolved[change_percent < -0.5] = -1.0  # SELL
        labels[:-lookahead] = resolved
        return labels

    def train_ensemble_model(self, df: pd.DataFrame, sentiment_score: int = 50) -> Dict:
        """Trains the PyTorch deep learning network"""
        try:
            df, feature_cols = self.build_features(df)
            labels = self.generate_labels(df)
            
            # Since we only take one static sentiment from historical endpoint currently,
            # we fill it over the array (ideal state: historic DB pulls actual historical sentiment)
            sentiments_normalized = np.full(len(df), (sentiment_score - 50) / 50.0) 

            X_raw = df[feature_cols].values

            # Ensure we have enough data for sequences
            if len(X_raw) <= self.sequence_length:
                return {"success": False, "error": f"Insufficient data: {len(X_raw)} rows < {self.sequence_length} sequence length"}

            # ── Fit the scaler on training rows only ─────────────────────────
            # This was `fit_transform` over the whole array before the split, so
            # the mean/variance used to normalise the training set was computed
            # partly from future bars that later became the test set. That is
            # look-ahead leakage and it inflates the reported accuracy.
            #
            # Sequence s spans rows [s, s + seq_len). The first test sequence is
            # `train_size`, so the last row any training sequence can see is
            # train_size + seq_len - 1 — everything from there on is held out.
            n_sequences = len(X_raw) - self.sequence_length
            train_size = int(0.8 * n_sequences)
            if train_size < 1:
                return {"success": False, "error": f"Insufficient data: only {n_sequences} sequences available"}

            train_row_end = train_size + self.sequence_length  # exclusive
            self.scaler.fit(X_raw[:train_row_end])
            X_scaled = self.scaler.transform(X_raw)

            X_tensor, s_tensor, y_tensor = self.build_sequences(X_scaled, sentiments_normalized, labels)

            # build_sequences drops the unresolved tail, so re-derive the split
            # point against the surviving sequence count.
            if len(X_tensor) < 2:
                return {"success": False, "error": "Insufficient labelled sequences after dropping unresolved tail"}
            split = min(train_size, len(X_tensor) - 1)

            train_dataset = TensorDataset(X_tensor[:split], s_tensor[:split], y_tensor[:split])
            test_dataset = TensorDataset(X_tensor[split:], s_tensor[split:], y_tensor[split:])

            train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
            test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)

            # Initialize Model & Optimizer
            self.model = CnnLstmHybrid(num_features=len(feature_cols), sequence_length=self.sequence_length).to(self.device)

            # Class-weighted loss. Labels are heavily skewed toward HOLD (any move
            # within ±0.5% over 4 bars), and with a plain unweighted loss the
            # network converges on predicting HOLD for everything while still
            # scoring a respectable raw accuracy. Weights are inverse-frequency
            # over the training split only.
            train_labels = y_tensor[:split]
            class_counts = torch.bincount(train_labels, minlength=3).float()
            class_weights = torch.where(
                class_counts > 0,
                class_counts.sum() / (3.0 * class_counts.clamp(min=1)),
                torch.ones_like(class_counts),
            ).to(self.device)
            criterion = nn.CrossEntropyLoss(weight=class_weights)
            optimizer = optim.Adam(self.model.parameters(), lr=0.001)

            # Training Loop
            epochs = 15 # Kept short to prevent out-of-memory timeout on free clouds
            for epoch in range(epochs):
                self.model.train()
                for batch_x, batch_s, batch_y in train_loader:
                    batch_x, batch_s, batch_y = batch_x.to(self.device), batch_s.to(self.device), batch_y.to(self.device)
                    
                    optimizer.zero_grad()
                    outputs = self.model(batch_x, batch_s)
                    loss = criterion(outputs, batch_y)
                    loss.backward()
                    optimizer.step()

            # Evaluation
            self.model.eval()
            all_preds = []
            all_targets = []
            with torch.no_grad():
                for batch_x, batch_s, batch_y in test_loader:
                    batch_x, batch_s, batch_y = batch_x.to(self.device), batch_s.to(self.device), batch_y.to(self.device)
                    outputs = self.model(batch_x, batch_s)
                    _, preds = torch.max(outputs, 1)
                    all_preds.extend(preds.cpu().numpy())
                    all_targets.extend(batch_y.cpu().numpy())

            accuracy = accuracy_score(all_targets, all_preds)
            precision = precision_score(all_targets, all_preds, average="weighted", zero_division=0)
            recall = recall_score(all_targets, all_preds, average="weighted", zero_division=0)
            f1 = f1_score(all_targets, all_preds, average="weighted", zero_division=0)
            # Macro-F1 weights all three classes equally, so a model that only
            # ever emits HOLD scores poorly here even when raw accuracy looks
            # healthy. This is the number to watch on an imbalanced label set.
            f1_macro = f1_score(all_targets, all_preds, average="macro", zero_division=0)

            self.model_accuracy = accuracy
            logger.info(
                f"CNN-LSTM trained — accuracy={accuracy:.3f} f1_weighted={f1:.3f} "
                f"f1_macro={f1_macro:.3f} (train={len(train_dataset)} test={len(test_dataset)})"
            )

            return {
                "success": True,
                "accuracy": float(accuracy),
                "precision": float(precision),
                "recall": float(recall),
                "f1_score": float(f1),
                "f1_macro": float(f1_macro),
            }
        except Exception as e:
            logger.error(f"DL Model training failed: {str(e)}")
            return {"success": False, "error": str(e)}

    def predict(self, df: pd.DataFrame, sentiment_score: int = 50, market_pcr: float = 1.0, technical_indicators: Dict = None) -> PredictionResult:
        if self.model is None:
            raise ValueError("DL Neural Network not trained yet")

        try:
            df, feature_cols = self.build_features(df)

            # build_features ends in dropna(), and the rolling windows inside it
            # (sma_50, the 50-period Fibonacci swing) consume the first ~50 bars.
            # A short input therefore leaves an EMPTY frame, and the padding
            # below used to dereference df.iloc[0] and raise IndexError.
            if len(df) == 0:
                raise ValueError(
                    "No usable rows after indicator warm-up — need roughly "
                    f"{self.sequence_length + 50} raw bars, received too few"
                )

            if len(df) < self.sequence_length:
                # Left-pad by repeating the oldest usable bar so the LSTM gets a
                # full window. The padding is synthetic, so flag it.
                pad_length = self.sequence_length - len(df)
                logger.warning(
                    f"Only {len(df)} bars after warm-up; left-padding {pad_length} "
                    f"synthetic rows to fill the {self.sequence_length}-step window"
                )
                pad_df = pd.DataFrame([df.iloc[0]] * pad_length)
                df = pd.concat([pad_df, df], ignore_index=True)

            X_raw = df[feature_cols].values
            X_scaled = self.scaler.transform(X_raw)
            
            # Predict only on the LAST available sequence
            last_sequence = X_scaled[-self.sequence_length:]
            X_tensor = torch.tensor(np.array([last_sequence]), dtype=torch.float32).to(self.device)
            s_tensor = torch.tensor(np.array([(sentiment_score - 50) / 50.0]), dtype=torch.float32).to(self.device)
            
            self.model.eval()
            with torch.no_grad():
                outputs = self.model(X_tensor, s_tensor) # Logits
                probs = torch.softmax(outputs, dim=1).cpu().numpy()[0]
                pred_idx = np.argmax(probs) # 0: SELL, 1: HOLD, 2: BUY
                confidence = float(np.max(probs) * 100)

            signal_map = {0: SignalType.SELL, 1: SignalType.HOLD, 2: SignalType.BUY}
            signal = signal_map[pred_idx]

            # Adjust confidence dynamically based on Options Wall Gravity (PCR)
            # PCR < 0.8 is severely Bearish. PCR > 1.2 is severely Bullish.
            if signal == SignalType.BUY and market_pcr < 0.85:
                confidence = max(30.0, confidence - 25.0) # Reject breakout due to huge Call Walls
            elif signal == SignalType.SELL and market_pcr > 1.2:
                confidence = max(30.0, confidence - 25.0) # Reject breakdown due to huge Put Walls
            elif signal == SignalType.BUY and market_pcr > 1.1:
                confidence = min(99.0, confidence + 15.0) # Confirm bullish breakout

            latest_data = df.iloc[-1]
            technical_score = self._calculate_technical_score(latest_data)

            current_price = df["close"].iloc[-1]
            momentum = latest_data.get("roc_10", 0) / 100
            predicted_price = current_price * (1 + np.clip(momentum, -0.02, 0.02))

            reasoning = self._generate_reasoning(signal, technical_score, sentiment_score, market_pcr, latest_data)

            return PredictionResult(
                signal=signal, confidence=confidence, technical_score=technical_score,
                sentiment_score=sentiment_score, predicted_price=predicted_price, reasoning=reasoning
            )
        except Exception as e:
            logger.error(f"DL Prediction failed: {str(e)}")
            raise

    def _calculate_technical_score(self, row: pd.Series) -> int:
        score = 50
        rsi = row.get("rsi", 50)
        if rsi < 30: score += 15
        elif rsi > 70: score -= 15
        else: score += (50 - rsi) * 0.3
        
        macd_diff = row.get("macd_diff", 0)
        score += np.clip(macd_diff * 50, -10, 10)
        
        # ── Pillar 2: Technical Confluence Adjustments ──
        # If very close to support (<1%), extremely bullish bounce setup
        if row.get("dist_to_support", 10) < 1.0: score += 10
        # If very close to resistance (<1%), extremely bearish rejection setup
        if row.get("dist_to_resistance", 10) < 1.0: score -= 10
        
        # If price is exactly at the Golden Pocket Fibonacci Retracement (0.618)
        if row.get("dist_to_fib618", 10) < 0.5: score += 15
        
        # Institutional VWAP proxy
        if row.get("dist_to_vwap", 0) < -2.0: score += 5
        elif row.get("dist_to_vwap", 0) > 2.0: score -= 5
        
        return int(np.clip(score, 0, 100))

    def _generate_reasoning(self, signal: SignalType, tech_score: int, sentiment_score: int, market_pcr: float, row: pd.Series) -> str:
        reasons = ["CNN-LSTM Output"]
        if signal == SignalType.BUY:
            if row.get("rsi", 50) < 30: reasons.append("RSI deep oversold")
            if row.get("dist_to_support", 10) < 1.0: reasons.append("Bouncing off Support Level")
            if row.get("dist_to_fib618", 10) < 0.5: reasons.append("Golden Pocket 0.618 Fibonacci Retracement")
            if sentiment_score > 60: reasons.append("Favourable sentiment fusion")
            if market_pcr > 1.1: reasons.append("Supported by massive OI Put Walls (PCR Bullish)")
            elif market_pcr < 0.85: reasons.append("Warning: Massive OI Call Wall resistance")
        elif signal == SignalType.SELL:
            if row.get("rsi", 50) > 70: reasons.append("RSI overbought")
            if row.get("dist_to_resistance", 10) < 1.0: reasons.append("Rejected at Resistance Level")
            if sentiment_score < 40: reasons.append("Negative sentiment fusion")
            if market_pcr < 0.85: reasons.append("Pushed by massive Call Sellers (PCR Bearish)")
        return " | ".join(reasons)

    def save(self, stock_key: str) -> bool:
        if self.model is None: return False
        try:
            os.makedirs(MODEL_DIR, exist_ok=True)
            path = os.path.join(MODEL_DIR, f"{stock_key}.pkl")
            # Save the PyTorch state dictated merged with the scaler
            joblib.dump({
                "model_state": self.model.state_dict(),
                "scaler": self.scaler,
                "feature_names": self.feature_names,
                "model_accuracy": self.model_accuracy,
                "sequence_length": self.sequence_length
            }, path)
            logger.info(f"DL Model saved: {path}")
            return True
        except Exception as e:
            logger.error(f"Failed to save DL model {stock_key}: {e}")
            return False

    def load(self, stock_key: str) -> bool:
        path = os.path.join(MODEL_DIR, f"{stock_key}.pkl")
        if not os.path.exists(path): return False
        try:
            data = joblib.load(path)
            self.scaler = data["scaler"]
            self.feature_names = data["feature_names"]
            self.model_accuracy = data.get("model_accuracy", 0.0)
            self.sequence_length = data.get("sequence_length", 60)
            
            # Reconstruct model Architecture
            self.model = CnnLstmHybrid(num_features=len(self.feature_names), sequence_length=self.sequence_length).to(self.device)
            self.model.load_state_dict(data["model_state"])
            self.model.eval()
            
            logger.info(f"DL Model loaded: {path} (accuracy={self.model_accuracy:.3f})")
            return True
        except Exception as e:
            logger.error(f"Failed to load DL model {stock_key}: {e}")
            return False