import axios from "axios";

const ML_API_URL = process.env.ML_API_URL || "http://localhost:5000";

interface StockDataPoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TrainingRequest {
  stock_id: number;
  symbol: string;
  historical_data: StockDataPoint[];
  sentiment_score?: number;
}

interface PredictionRequest {
  stock_id: number;
  symbol: string;
  latest_data: StockDataPoint[];
  sentiment_score?: number;
  market_pcr?: number;
  technical_indicators?: Record<string, number>;
}

interface MLPredictionResult {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0-100
  technical_score: number; // 0-100
  sentiment_score: number; // 0-100
  predicted_price: number;
  reasoning: string;
  stock_id: number;
  symbol: string;
}

interface TrainingResult {
  success: boolean;
  stock_id: number;
  symbol: string;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1_score?: number;
  error?: string;
}

/**
 * Python ML Service Client
 * Communicates with FastAPI ML server for advanced predictions
 */
export class MLServiceClient {
  private apiUrl: string;
  private timeout: number = 30000; // 30 seconds

  constructor(apiUrl: string = ML_API_URL) {
    this.apiUrl = apiUrl;
  }

  /**
   * Train ML model for a stock with historical data
   */
  async trainModel(data: TrainingRequest): Promise<TrainingResult> {
    try {
      const response = await axios.post<TrainingResult>(`${this.apiUrl}/train`, data, {
        timeout: this.timeout,
      });
      console.log(`[MLService] Model trained for ${data.symbol}: ${response.data.accuracy?.toFixed(3)}`);
      return response.data;
    } catch (error) {
      console.error(`[MLService] Training failed for ${data.symbol}:`, (error as Error)?.message);
      throw new Error(`ML training failed: ${(error as Error)?.message}`);
    }
  }

  /**
   * Make prediction using Python ML model
   */
  async predict(data: PredictionRequest): Promise<MLPredictionResult> {
    try {
      const response = await axios.post<MLPredictionResult>(`${this.apiUrl}/predict`, data, {
        timeout: this.timeout,
      });

      console.log(
        `[MLService] Prediction for ${data.symbol}: ${response.data.signal} ` +
          `(${response.data.confidence.toFixed(1)}% confidence, ` +
          `technical: ${response.data.technical_score}/100)`
      );

      return response.data;
    } catch (error) {
      console.error(`[MLService] Prediction failed for ${data.symbol}:`, (error as Error)?.message);
      throw new Error(`ML prediction failed: ${(error as Error)?.message}`);
    }
  }

  /**
   * Get model status for a stock
   */
  async getModelStatus(stockId: number, symbol: string) {
    try {
      const response = await axios.get(`${this.apiUrl}/model-status/${stockId}/${symbol}`, {
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      console.error(`[MLService] Failed to get model status:`, (error as Error)?.message);
      return { trained: false, accuracy: null };
    }
  }

  /**
   * List all trained models
   */
  async listModels() {
    try {
      const response = await axios.get(`${this.apiUrl}/models`, {
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      console.error(`[MLService] Failed to list models:`, (error as Error)?.message);
      return { count: 0, models: [] };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.apiUrl}/health`, {
        timeout: 5000,
      });
      // Accept "healthy", "ok", or any 2xx status — Python services use different conventions
      const status = response.data?.status;
      return response.status >= 200 && response.status < 300 &&
        (status === "healthy" || status === "ok" || status === "running" || !status);
    } catch (error) {
      console.warn(`[MLService] Health check failed: ${(error as Error)?.message}`);
      return false;
    }
  }
}

// Export singleton instance
export const mlServiceClient = new MLServiceClient();
