import axios from "axios";
import { invokeLLM } from "./llm";

export interface MacroIndicator {
  score: number;       // -100 to 100
  gravity: "Extreme Bearish" | "Bearish" | "Neutral" | "Bullish" | "Extreme Bullish";
  latestHeadline: string;
}

/**
 * Fetches Global Macro-Economic events from AlphaVantage/Finnhub/News API.
 * Translates them via Groq LLM to a systematic Market Gravity score.
 */
export async function getGlobalMacroGravity(): Promise<MacroIndicator> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  
  if (!apiKey) {
    console.warn("[Macro] ALPHA_VANTAGE_API_KEY missing. Returning Neutral Macro Gravity.");
    return { score: 0, gravity: "Neutral", latestHeadline: "Waiting for Macro Data Integration..." };
  }

  try {
    // 1. Fetch live market news & sentiment from AlphaVantage
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&limit=5&apikey=${apiKey}`;
    const response = await axios.get(url);
    
    const feed = response.data.feed;
    if (!feed || feed.length === 0) {
      return { score: 0, gravity: "Neutral", latestHeadline: "No significant global macro events today." };
    }

    // 2. Extract Top 5 headlines to feed to Groq for Macro Analysis
    const headlines = feed.slice(0, 5).map((item: any) => item.title).join(" | ");

    // 3. Score the structural risk using Groq Swarm Intelligence
    const groqPrompt = `
      You are the Chief Macro-Economist for an institutional quant fund in India.
      Analyze the following recent global macroeconomic headlines:
      "${headlines}"
      
      Score the total structural gravity these headlines place on the Indian Stock Market (Nifty 50).
      Return ONLY a JSON object exactly like this:
      {
        "score": 50,
        "gravity": "Bullish",
        "headline_summary": "A 1-sentence summary of the biggest macro risk/catalyst"
      }
    `;

    const rawLlmResponse = await invokeLLM({
      messages: [{ role: "user", content: groqPrompt }],
      responseFormat: { type: "json_object" }
    });
    
    const content = rawLlmResponse.choices[0].message.content as string;
    const result = JSON.parse(content);

    return {
      score: result.score,
      gravity: result.gravity,
      latestHeadline: result.headline_summary
    };

  } catch (error) {
    console.error("[Macro] Failed to fetch or process macro economics data:", error);
    return { score: 0, gravity: "Neutral", latestHeadline: "System unable to process macro events." };
  }
}
