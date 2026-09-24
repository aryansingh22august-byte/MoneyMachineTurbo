"""
Simple predictor for Indian stock data.
This script uses historical price data to build technical features and output buy/sell/hold signals.
"""

from __future__ import annotations
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import numpy as np


def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["timestamp"] if "timestamp" in pd.read_csv(path, nrows=0).columns else [0])
    df = df.dropna(subset=["close"])
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["return"] = df["close"].pct_change()
    df["sma_20"] = df["close"].rolling(20).mean()
    df["sma_50"] = df["close"].rolling(50).mean()
    df["ema_12"] = df["close"].ewm(span=12, adjust=False).mean()
    df["ema_26"] = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"] = df["ema_12"] - df["ema_26"]
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss
    df["rsi"] = 100 - 100 / (1 + rs)
    df["signal"] = 0
    df.loc[df["return"] > 0.01, "signal"] = 1
    df.loc[df["return"] < -0.01, "signal"] = -1
    df = df.dropna().reset_index(drop=True)
    return df


def train_model(df: pd.DataFrame):
    X = df[["sma_20", "sma_50", "macd", "rsi", "volume"]].copy()
    y = df["signal"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=False)
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    accuracy = accuracy_score(y_test, preds)
    print(f"Model accuracy: {accuracy:.3f}")
    return model


def predict_next(model, row: pd.Series) -> str:
    features = np.array([[row["sma_20"], row["sma_50"], row["macd"], row["rsi"], row["volume"]]])
    prediction = model.predict(features)[0]
    if prediction == 1:
        return "BUY"
    if prediction == -1:
        return "SELL"
    return "HOLD"


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Train a simple Indian stock prediction model.")
    parser.add_argument("--input", required=True, help="Path to CSV with historical OHLCV data")
    parser.add_argument("--output", required=False, help="Optional output model path")
    args = parser.parse_args()

    data = load_data(args.input)
    data = build_features(data)
    model = train_model(data)
    if args.output:
        import joblib
        joblib.dump(model, args.output)
        print(f"Saved trained model to {args.output}")
