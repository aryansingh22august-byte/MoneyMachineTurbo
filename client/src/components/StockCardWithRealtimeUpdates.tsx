import React from "react";
import { useRealtimeSentiment, useRealtimePrediction, useRealtimeConnection } from "../hooks/useRealtimeUpdates";

export function StockCardWithRealtimeUpdates({ stockId }: { stockId: number }) {
  const sentiment = useRealtimeSentiment(stockId);
  const prediction = useRealtimePrediction(stockId);
  const isConnected = useRealtimeConnection();

  return (
    <div className="rounded-lg border p-4">
      {/* Connection Status */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`h-2 w-2 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-gray-400'
          }`}
        />
        <span className="text-xs text-gray-600">
          {isConnected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Sentiment */}
      {sentiment ? (
        <div className="mb-3">
          <div className="text-sm font-medium text-gray-700">Sentiment</div>
          <div className="flex items-center gap-2 mt-1">
            <div className="text-xl font-bold">{sentiment.sentimentScore}/100</div>
            <span className="text-xs bg-blue-100 px-2 py-1 rounded">
              {sentiment.sentimentLabel}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {sentiment.newsCount} articles, {sentiment.sources.length} sources
          </div>
          {/* Updated indicator */}
          <div className="text-xs text-green-600 mt-1">
            ✓ Updated {new Date(sentiment.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ) : (
        <div className="mb-3 h-16 bg-gray-100 rounded animate-pulse" />
      )}

      {/* Prediction */}
      {prediction ? (
        <div>
          <div className="text-sm font-medium text-gray-700">Prediction</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`px-3 py-1 rounded font-bold text-white ${
                prediction.signal === 'BUY'
                  ? 'bg-green-500'
                  : prediction.signal === 'SELL'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
              }`}
            >
              {prediction.signal}
            </span>
            <span className="text-sm">
              {Math.round(prediction.confidence * 100)}% confidence
            </span>
          </div>
          {/* Updated indicator */}
          <div className="text-xs text-green-600 mt-1">
            ✓ Updated {new Date(prediction.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ) : (
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
      )}
    </div>
  );
}
