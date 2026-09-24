import axios from "axios";
import { getUpstoxAccessToken } from "./upstoxAuth";

const UPSTOX_API_URL = "https://api.upstox.com/v2";

export interface OptionWallData {
  pcr: number;
  callResistance: { strike: number; oi: number };
  putSupport: { strike: number; oi: number };
  strikes: Array<{ strike: number; callOi: number; putOi: number }>;
  isSimulated: boolean;
}

export const PCR_NEUTRAL = 1.0;

// 30-minute fallback cache as requested
const CACHE_TTL_MS = 30 * 60 * 1000; 
let _optionsCache = new Map<string, { data: OptionWallData; timestamp: number }>();

async function getNearestExpiry(symbol: string, token: string): Promise<string | null> {
  try {
    const res = await axios.get(`${UPSTOX_API_URL}/option/contract`, {
      params: { instrument_key: symbol },
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });
    
    if (!res.data?.data || !Array.isArray(res.data.data)) return null;
    
    const today = new Date().toISOString().split("T")[0];
    const expiries = new Set<string>();
    
    for (const contract of res.data.data) {
      if (contract.expiry_date && contract.expiry_date >= today) {
        expiries.add(contract.expiry_date);
      }
    }
    
    const sorted = Array.from(expiries).sort();
    return sorted.length > 0 ? sorted[0] : null;
  } catch (error: any) {
    console.error(`[Options] Error fetching nearest expiry for ${symbol}:`, error.message);
    return null;
  }
}

function getSyntheticFallback(symbol: string): OptionWallData {
  const dummyStrikeBase = symbol.includes("Nifty 50") ? 22000 : 1500;
  const strikes = [];
  for (let i = -5; i <= 5; i++) {
    const strike = dummyStrikeBase + (i * (symbol.includes("Nifty 50") ? 50 : 10));
    const baseCallOi = 1000000 * (1 / (1 + Math.abs(i - 2))); 
    const basePutOi = 1000000 * (1 / (1 + Math.abs(i + 2)));
    strikes.push({
      strike,
      callOi: Math.floor(baseCallOi * (0.8 + Math.random() * 0.4)),
      putOi: Math.floor(basePutOi * (0.8 + Math.random() * 0.4)),
    });
  }
  return {
    pcr: PCR_NEUTRAL,
    callResistance: { strike: dummyStrikeBase + 200, oi: 5400000 },
    putSupport: { strike: dummyStrikeBase - 150, oi: 7200000 },
    strikes,
    isSimulated: true,
  };
}

export async function fetchOptionWalls(symbol: string = "NSE_INDEX|Nifty 50"): Promise<OptionWallData> {
  const token = getUpstoxAccessToken();
  const cached = _optionsCache.get(symbol);
  
  // Check if cache is fresh
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  if (!token) {
    if (cached) return cached.data; // Serve stale cache if streaming is cut off
    return getSyntheticFallback(symbol);
  }

  try {
    const nearestExpiry = await getNearestExpiry(symbol, token);
    if (!nearestExpiry) {
      throw new Error("Could not find nearest expiry date");
    }

    const res = await axios.get(`${UPSTOX_API_URL}/option/chain`, {
      params: { instrument_key: symbol, expiry_date: nearestExpiry },
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    });

    const chainData = res.data?.data;
    if (!chainData || !Array.isArray(chainData) || chainData.length === 0) {
      throw new Error("Invalid option chain response");
    }

    let totalCallOi = 0;
    let totalPutOi = 0;
    let maxCallOi = 0;
    let maxPutOi = 0;
    let callResStrike = 0;
    let putSupStrike = 0;
    let spotPrice = chainData[0]?.underlying_spot_price || 0;

    const allStrikes = chainData.map((item: any) => {
      const strike = item.strike_price || 0;
      const callOi = item.call_options?.market_data?.oi || 0;
      const putOi = item.put_options?.market_data?.oi || 0;

      totalCallOi += callOi;
      totalPutOi += putOi;

      if (callOi > maxCallOi) {
        maxCallOi = callOi;
        callResStrike = strike;
      }
      if (putOi > maxPutOi) {
        maxPutOi = putOi;
        putSupStrike = strike;
      }

      return { strike, callOi, putOi };
    }).sort((a, b) => a.strike - b.strike);

    const pcr = totalCallOi > 0 ? Number((totalPutOi / totalCallOi).toFixed(4)) : PCR_NEUTRAL;

    // Filter strikes to +/- 5 around the spot price (ATM)
    let atmIndex = allStrikes.findIndex(s => s.strike >= spotPrice);
    if (atmIndex === -1) atmIndex = Math.floor(allStrikes.length / 2);
    
    const startIndex = Math.max(0, atmIndex - 5);
    const endIndex = Math.min(allStrikes.length, atmIndex + 6);
    const filteredStrikes = allStrikes.slice(startIndex, endIndex);

    const liveData: OptionWallData = {
      pcr,
      callResistance: { strike: callResStrike, oi: maxCallOi },
      putSupport: { strike: putSupStrike, oi: maxPutOi },
      strikes: filteredStrikes,
      isSimulated: false,
    };

    // Cache the live data
    _optionsCache.set(symbol, { data: liveData, timestamp: Date.now() });
    
    return liveData;

  } catch (error: any) {
    console.error(`[Options] Failed to fetch live chain for ${symbol}:`, error.message);
    // If live streaming gets cut off, show the stopped data (stale cache) as requested
    if (cached) {
      console.log(`[Options] Serving stale cache for ${symbol} as fallback.`);
      return cached.data;
    }
    return getSyntheticFallback(symbol);
  }
}

export const optionsService = {
  fetchOptionWalls
};

