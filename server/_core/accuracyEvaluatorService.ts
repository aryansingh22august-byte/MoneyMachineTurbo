import { getUnresolvedPredictions, getPriceAtTime, insertAccuracyRecord } from "../db";

const EVALUATION_HORIZON_MS = 60 * 60 * 1000; // 60 minutes
let evaluatorInterval: NodeJS.Timeout | null = null;

export function startAccuracyEvaluatorService() {
  if (evaluatorInterval) return;
  console.log("[AccuracyEvaluator] Starting native ML feedback loop service...");

  // Run the evaluator every 5 minutes
  evaluatorInterval = setInterval(evaluatePendingPredictions, 5 * 60 * 1000);
  
  // Run once immediately on startup
  setTimeout(evaluatePendingPredictions, 5000);
}

export function stopAccuracyEvaluatorService() {
  if (evaluatorInterval) {
    clearInterval(evaluatorInterval);
    evaluatorInterval = null;
    console.log("[AccuracyEvaluator] Service stopped.");
  }
}

async function evaluatePendingPredictions() {
  try {
    const unresolved = await getUnresolvedPredictions(EVALUATION_HORIZON_MS);
    if (unresolved.length === 0) return;

    console.log(`[AccuracyEvaluator] Found ${unresolved.length} pending predictions ready for evaluation.`);

    for (const prediction of unresolved) {
      try {
        // Find price exactly at the time of prediction
        const priceAtPred = await getPriceAtTime(prediction.stockId, prediction.timestamp);
        if (!priceAtPred) continue;

        // Find price exactly at the horizon time (60 mins later)
        const targetResolutionTime = new Date(new Date(prediction.timestamp).getTime() + EVALUATION_HORIZON_MS).toISOString();
        const priceAtRes = await getPriceAtTime(prediction.stockId, targetResolutionTime);
        if (!priceAtRes) continue;

        const pStart = priceAtPred.lastPrice;
        const pEnd = priceAtRes.lastPrice;

        let returnPercentage = 0;
        let isCorrect: 0 | 1 = 0;

        // Reward Architecture Calculation for Reinforcement Learning
        if (prediction.signal === "BUY") {
          returnPercentage = ((pEnd - pStart) / pStart) * 100;
          isCorrect = returnPercentage > 0 ? 1 : 0;
        } else if (prediction.signal === "SELL") {
          returnPercentage = ((pStart - pEnd) / pStart) * 100;
          isCorrect = returnPercentage > 0 ? 1 : 0;
        }

        // Insert exactly into DB to serve as the Ground Truth for the RL Agent
        await insertAccuracyRecord({
          stockId: prediction.stockId,
          predictionId: prediction.id,
          actualSignal: prediction.signal,
          isCorrect,
          priceAtPrediction: pStart,
          priceAtResolution: pEnd,
          returnPercentage: Number(returnPercentage.toFixed(2)),
          resolutionDate: targetResolutionTime
        });

        console.log(`[AccuracyEvaluator] Evaluated Prediction #${prediction.id} (${prediction.signal}): Return = ${returnPercentage.toFixed(2)}%, Correct = ${isCorrect}`);
      } catch (err) {
        console.error(`[AccuracyEvaluator] Error evaluating prediction #${prediction.id}:`, err);
      }
    }
  } catch (error) {
    console.error("[AccuracyEvaluator] Engine error:", error);
  }
}
