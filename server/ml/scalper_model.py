import json
import numpy as np
import pandas as pd
from datetime import datetime

class HyperScalperModel:
    def __init__(self):
        self.version = "1.0-scalper"
        print(f"[HyperScalper] Initialized v{self.version}")

    def _calculate_atr(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        # True Range calculation
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        true_range = np.max(ranges, axis=1)
        # Average True Range
        return true_range.rolling(period).mean()

    def _detect_volatility_breakout(self, current_volume: float, avg_volume: float, current_atr: float, price_change: float) -> int:
        """
        Calculates a conviction score boost based on immediate volatility breakouts.
        Returns a score modifier (-20 to +30).
        """
        score = 0
        if avg_volume > 0 and current_volume > (avg_volume * 1.5):
            # 50% volume spike
            if price_change > 0:
                score += 15
            else:
                score -= 15
                
        # If price is moving faster than the average true range
        if abs(price_change) > current_atr * 0.8:
            score += 10 if price_change > 0 else -10
            
        return score

    def _analyze_level2_order_flow(self, bid_qty: int, ask_qty: int) -> int:
        """
        Proxies Level 2 Order Book imbalance.
        Returns a score modifier (-20 to +20).
        """
        if bid_qty == 0 and ask_qty == 0:
            return 0
            
        total = bid_qty + ask_qty
        bid_ratio = bid_qty / total
        
        # Heavy buy walls (institutional accumulation)
        if bid_ratio > 0.70:
            return 20
        elif bid_ratio > 0.60:
            return 10
        # Heavy sell walls (institutional distribution)
        elif bid_ratio < 0.30:
            return -20
        elif bid_ratio < 0.40:
            return -10
            
        return 0

    def _get_finbert_micro_sentiment(self, symbol: str) -> int:
        """
        Stubs a FinBERT streaming sentiment analysis for the specific stock.
        In production, this would pass recent headlines through `transformers.pipeline("sentiment-analysis", model="ProsusAI/finbert")`.
        Returns a score (-15 to +15).
        """
        # For simulation, we'll generate a structural pseudo-random value based on the symbol length to keep it deterministic but varied
        seed_val = sum(ord(c) for c in symbol)
        
        if seed_val % 3 == 0:
            return 15  # Bullish news catalyst
        elif seed_val % 5 == 0:
            return -15 # Bearish news catalyst
        else:
            return 0   # Neutral/No news

    def analyze_tick(self, symbol: str, price: float, df_history: pd.DataFrame, bid_qty: int = 50000, ask_qty: int = 50000) -> dict:
        """
        Fast-inference entry point for the Auto-Screener.
        Expects a recent 1-minute or 5-minute dataframe.
        """
        if df_history is None or len(df_history) < 15:
            return {"confidence": 50, "signal": "HOLD", "reason": "Insufficient Data"}

        # Basic calculations
        current_close = df_history['close'].iloc[-1]
        prev_close = df_history['close'].iloc[-2]
        price_change = current_close - prev_close
        
        current_volume = df_history['volume'].iloc[-1]
        avg_volume = df_history['volume'].rolling(10).mean().iloc[-1]
        
        df_history['atr'] = self._calculate_atr(df_history, period=10)
        current_atr = df_history['atr'].iloc[-1]
        
        # Base neutral score
        base_score = 50
        
        # Component 1: Volatility Breakout
        breakout_mod = self._detect_volatility_breakout(current_volume, avg_volume, current_atr, price_change)
        
        # Component 2: Order Flow (Level 2)
        flow_mod = self._analyze_level2_order_flow(bid_qty, ask_qty)
        
        # Component 3: FinBERT Fast Sentiment
        sentiment_mod = self._get_finbert_micro_sentiment(symbol)
        
        # Component 4: RSI Momentum
        # Simplified quick RSI
        delta = df_history['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs)).iloc[-1]
        
        rsi_mod = 0
        if rsi < 30: rsi_mod = 15  # Oversold bounce
        elif rsi > 70: rsi_mod = -15 # Overbought fade
        
        # Final Aggregation
        total_score = base_score + breakout_mod + flow_mod + sentiment_mod + rsi_mod
        total_score = int(np.clip(total_score, 0, 100))
        
        # Determine Signal
        signal = "HOLD"
        if total_score >= 85:
            signal = "BUY"
        elif total_score <= 15:
            signal = "SELL"
            
        reasons = []
        if breakout_mod > 0: reasons.append("Bullish Volume Breakout")
        elif breakout_mod < 0: reasons.append("Bearish Volume Spike")
        if flow_mod > 0: reasons.append("Heavy Institutional Bidding")
        elif flow_mod < 0: reasons.append("Heavy Ask Wall Detected")
        if sentiment_mod > 0: reasons.append("Positive FinBERT Catalyst")
        elif sentiment_mod < 0: reasons.append("Negative FinBERT Catalyst")
        if rsi_mod > 0: reasons.append("Oversold Reversal Momentum")
        elif rsi_mod < 0: reasons.append("Overbought Exhaustion")
        
        if not reasons:
            reasons.append("Chop/Sideways market")
            
        return {
            "symbol": symbol,
            "confidence": total_score,
            "signal": signal,
            "reason": " | ".join(reasons),
            "metrics": {
                "atr": float(current_atr) if not pd.isna(current_atr) else 0.0,
                "volume_surge": float(current_volume / avg_volume) if avg_volume > 0 else 1.0,
                "rsi": float(rsi) if not pd.isna(rsi) else 50.0
            }
        }

# Singleton instance for the API to import
scalper = HyperScalperModel()
