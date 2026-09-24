import axios from "axios";
import {
  getAllStocks,
  getAverageSentimentScore,
  insertPrediction,
  insertStockPrice,
  upsertStock,
  invalidateRankedCache,
} from "../db";
import { broadcastLiveUpdate } from "./realTimeService";
import { broadcastFibAlert } from "./realTimeService";
import { broadcastPredictionUpdate } from "./realtimeUpdateServer";
import { runFibonacciAgent } from "./fibonacciAgent";
import { mlServiceClient } from "./mlServiceClient";
import { optionsService, PCR_NEUTRAL } from "./optionsService";
import { generateSMCReport } from "./smcEngine";

type DefaultStock = {
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  sector: string;
  industry: string;
};

// Global cache for SMC reports to sync between Yahoo sync and Upstox ticks
export const smcCache = new Map<number, any>();
export function getSMCReport(stockId: number) {
  return smcCache.get(stockId);
}

const DEFAULT_STOCKS: DefaultStock[] = [
  // ── Nifty 50 ──────────────────────────────────────────────────────────────
  // IT & Technology
  { symbol: "TCS.NS", companyName: "Tata Consultancy Services", exchange: "NSE", sector: "IT", industry: "IT Services" },
  { symbol: "INFY.NS", companyName: "Infosys Limited", exchange: "NSE", sector: "IT", industry: "IT Services" },
  { symbol: "HCLTECH.NS", companyName: "HCL Technologies Limited", exchange: "NSE", sector: "IT", industry: "IT Services" },
  { symbol: "WIPRO.NS", companyName: "Wipro Limited", exchange: "NSE", sector: "IT", industry: "IT Services" },
  { symbol: "TECHM.NS", companyName: "Tech Mahindra Limited", exchange: "NSE", sector: "IT", industry: "IT Services" },
  // Banking & Finance
  { symbol: "HDFCBANK.NS", companyName: "HDFC Bank Limited", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "ICICIBANK.NS", companyName: "ICICI Bank Limited", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "SBIN.NS", companyName: "State Bank of India", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "AXISBANK.NS", companyName: "Axis Bank Limited", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "KOTAKBANK.NS", companyName: "Kotak Mahindra Bank", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "BAJFINANCE.NS", companyName: "Bajaj Finance Limited", exchange: "NSE", sector: "Financial Services", industry: "NBFC" },
  { symbol: "BAJAJFINSV.NS", companyName: "Bajaj Finserv Limited", exchange: "NSE", sector: "Financial Services", industry: "Insurance" },
  { symbol: "HDFCLIFE.NS", companyName: "HDFC Life Insurance", exchange: "NSE", sector: "Financial Services", industry: "Insurance" },
  { symbol: "SBILIFE.NS", companyName: "SBI Life Insurance", exchange: "NSE", sector: "Financial Services", industry: "Insurance" },
  { symbol: "ICICIGI.NS", companyName: "ICICI Lombard General Insurance", exchange: "NSE", sector: "Financial Services", industry: "Insurance" },
  // Energy & Utilities
  { symbol: "RELIANCE.NS", companyName: "Reliance Industries Limited", exchange: "NSE", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "ONGC.NS", companyName: "Oil and Natural Gas Corporation", exchange: "NSE", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "BPCL.NS", companyName: "Bharat Petroleum Corporation", exchange: "NSE", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "NTPC.NS", companyName: "NTPC Limited", exchange: "NSE", sector: "Energy", industry: "Power" },
  { symbol: "POWERGRID.NS", companyName: "Power Grid Corporation", exchange: "NSE", sector: "Energy", industry: "Power Transmission" },
  { symbol: "COALINDIA.NS", companyName: "Coal India Limited", exchange: "NSE", sector: "Energy", industry: "Mining" },
  // Telecom
  { symbol: "BHARTIARTL.NS", companyName: "Bharti Airtel Limited", exchange: "NSE", sector: "Telecom", industry: "Telecom Services" },
  // Automobile
  { symbol: "MARUTI.NS", companyName: "Maruti Suzuki India Limited", exchange: "NSE", sector: "Automobile", industry: "Auto Manufacturers" },
  { symbol: "TATAMOTORS.NS", companyName: "Tata Motors Limited", exchange: "NSE", sector: "Automobile", industry: "Auto Manufacturers" },
  { symbol: "BAJAJ-AUTO.NS", companyName: "Bajaj Auto Limited", exchange: "NSE", sector: "Automobile", industry: "Two Wheelers" },
  { symbol: "HEROMOTOCO.NS", companyName: "Hero MotoCorp Limited", exchange: "NSE", sector: "Automobile", industry: "Two Wheelers" },
  { symbol: "EICHERMOT.NS", companyName: "Eicher Motors Limited", exchange: "NSE", sector: "Automobile", industry: "Two Wheelers" },
  { symbol: "M&M.NS", companyName: "Mahindra & Mahindra Limited", exchange: "NSE", sector: "Automobile", industry: "Auto Manufacturers" },
  // FMCG
  { symbol: "HINDUNILVR.NS", companyName: "Hindustan Unilever Limited", exchange: "NSE", sector: "FMCG", industry: "Consumer Goods" },
  { symbol: "ITC.NS", companyName: "ITC Limited", exchange: "NSE", sector: "FMCG", industry: "Tobacco & FMCG" },
  { symbol: "NESTLEIND.NS", companyName: "Nestle India Limited", exchange: "NSE", sector: "FMCG", industry: "Food & Beverages" },
  { symbol: "BRITANNIA.NS", companyName: "Britannia Industries Limited", exchange: "NSE", sector: "FMCG", industry: "Food & Beverages" },
  { symbol: "TATACONSUM.NS", companyName: "Tata Consumer Products", exchange: "NSE", sector: "FMCG", industry: "Food & Beverages" },
  // Pharma
  { symbol: "SUNPHARMA.NS", companyName: "Sun Pharmaceutical Industries", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "DRREDDY.NS", companyName: "Dr. Reddy's Laboratories", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "DIVISLAB.NS", companyName: "Divi's Laboratories", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "CIPLA.NS", companyName: "Cipla Limited", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "APOLLOHOSP.NS", companyName: "Apollo Hospitals Enterprise", exchange: "NSE", sector: "Pharma", industry: "Healthcare" },
  // Metals
  { symbol: "TATASTEEL.NS", companyName: "Tata Steel Limited", exchange: "NSE", sector: "Metals", industry: "Steel" },
  { symbol: "JSWSTEEL.NS", companyName: "JSW Steel Limited", exchange: "NSE", sector: "Metals", industry: "Steel" },
  { symbol: "HINDALCO.NS", companyName: "Hindalco Industries Limited", exchange: "NSE", sector: "Metals", industry: "Aluminum" },
  // Cement & Infra
  { symbol: "ULTRACEMCO.NS", companyName: "UltraTech Cement Limited", exchange: "NSE", sector: "Cement", industry: "Cement" },
  { symbol: "GRASIM.NS", companyName: "Grasim Industries Limited", exchange: "NSE", sector: "Cement", industry: "Cement & Diversified" },
  { symbol: "LT.NS", companyName: "Larsen & Toubro Limited", exchange: "NSE", sector: "Infrastructure", industry: "Engineering & Construction" },
  // Consumer & Retail
  { symbol: "TITAN.NS", companyName: "Titan Company Limited", exchange: "NSE", sector: "Consumer", industry: "Jewellery & Watches" },
  { symbol: "ASIANPAINT.NS", companyName: "Asian Paints Limited", exchange: "NSE", sector: "Consumer", industry: "Paints" },
  // Ports & Diversified
  { symbol: "ADANIPORTS.NS", companyName: "Adani Ports & SEZ", exchange: "NSE", sector: "Infrastructure", industry: "Ports & Logistics" },
  { symbol: "ADANIENT.NS", companyName: "Adani Enterprises Limited", exchange: "NSE", sector: "Diversified", industry: "Diversified" },
  { symbol: "UPL.NS", companyName: "UPL Limited", exchange: "NSE", sector: "Chemicals", industry: "Agrochemicals" },
  { symbol: "INDUSINDBK.NS", companyName: "IndusInd Bank Limited", exchange: "NSE", sector: "Financial Services", industry: "Banking" },

  // ── Nifty Next 50 ─────────────────────────────────────────────────────────
  // Infrastructure & Conglomerates
  { symbol: "ABB.NS", companyName: "ABB India Limited", exchange: "NSE", sector: "Infrastructure", industry: "Industrial Equipment" },
  { symbol: "ADANIGREEN.NS", companyName: "Adani Green Energy", exchange: "NSE", sector: "Energy", industry: "Renewable Energy" },
  { symbol: "AMBUJACEM.NS", companyName: "Ambuja Cements Limited", exchange: "NSE", sector: "Cement", industry: "Cement" },
  { symbol: "DLF.NS", companyName: "DLF Limited", exchange: "NSE", sector: "Real Estate", industry: "Real Estate" },
  { symbol: "SIEMENS.NS", companyName: "Siemens Limited", exchange: "NSE", sector: "Infrastructure", industry: "Industrial Equipment" },
  // Pharma / Healthcare
  { symbol: "AUROPHARMA.NS", companyName: "Aurobindo Pharma Limited", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "LUPIN.NS", companyName: "Lupin Limited", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "TORNTPHARM.NS", companyName: "Torrent Pharmaceuticals", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  { symbol: "ZYDUSLIFE.NS", companyName: "Zydus Lifesciences Limited", exchange: "NSE", sector: "Pharma", industry: "Pharmaceuticals" },
  // Banking
  { symbol: "BANKBARODA.NS", companyName: "Bank of Baroda", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "CANBK.NS", companyName: "Canara Bank", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "PNB.NS", companyName: "Punjab National Bank", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "IDFCFIRSTB.NS", companyName: "IDFC First Bank Limited", exchange: "NSE", sector: "Financial Services", industry: "Banking" },
  { symbol: "CHOLAFIN.NS", companyName: "Cholamandalam Investment", exchange: "NSE", sector: "Financial Services", industry: "NBFC" },
  { symbol: "MUTHOOTFIN.NS", companyName: "Muthoot Finance Limited", exchange: "NSE", sector: "Financial Services", industry: "NBFC" },
  { symbol: "RECLTD.NS", companyName: "REC Limited", exchange: "NSE", sector: "Financial Services", industry: "Power Finance" },
  // FMCG
  { symbol: "COLPAL.NS", companyName: "Colgate-Palmolive India", exchange: "NSE", sector: "FMCG", industry: "Personal Care" },
  { symbol: "DABUR.NS", companyName: "Dabur India Limited", exchange: "NSE", sector: "FMCG", industry: "Consumer Goods" },
  { symbol: "GODREJCP.NS", companyName: "Godrej Consumer Products", exchange: "NSE", sector: "FMCG", industry: "Consumer Goods" },
  { symbol: "MARICO.NS", companyName: "Marico Limited", exchange: "NSE", sector: "FMCG", industry: "Consumer Goods" },
  // Consumer & Retail
  { symbol: "BERGEPAINT.NS", companyName: "Berger Paints India", exchange: "NSE", sector: "Consumer", industry: "Paints" },
  { symbol: "HAVELLS.NS", companyName: "Havells India Limited", exchange: "NSE", sector: "Consumer", industry: "Electrical Equipment" },
  { symbol: "PIDILITIND.NS", companyName: "Pidilite Industries Limited", exchange: "NSE", sector: "Consumer", industry: "Adhesives & Chemicals" },
  { symbol: "TRENT.NS", companyName: "Trent Limited", exchange: "NSE", sector: "Consumer", industry: "Retail" },
  { symbol: "VOLTAS.NS", companyName: "Voltas Limited", exchange: "NSE", sector: "Consumer", industry: "Air Conditioning" },
  // Metals & Mining
  { symbol: "SAIL.NS", companyName: "Steel Authority of India", exchange: "NSE", sector: "Metals", industry: "Steel" },
  { symbol: "JINDALSTEL.NS", companyName: "Jindal Steel & Power", exchange: "NSE", sector: "Metals", industry: "Steel" },
  { symbol: "VEDL.NS", companyName: "Vedanta Limited", exchange: "NSE", sector: "Metals", industry: "Diversified Metals" },
  { symbol: "NMDC.NS", companyName: "NMDC Limited", exchange: "NSE", sector: "Metals", industry: "Iron Ore Mining" },
  { symbol: "HINDZINC.NS", companyName: "Hindustan Zinc Limited", exchange: "NSE", sector: "Metals", industry: "Zinc" },
  // IT
  { symbol: "NAUKRI.NS", companyName: "Info Edge (India) Limited", exchange: "NSE", sector: "IT", industry: "Internet Services" },
  { symbol: "OFSS.NS", companyName: "Oracle Financial Services", exchange: "NSE", sector: "IT", industry: "IT Services" },
  // Energy
  { symbol: "IOC.NS", companyName: "Indian Oil Corporation", exchange: "NSE", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "IGL.NS", companyName: "Indraprastha Gas Limited", exchange: "NSE", sector: "Energy", industry: "Gas Distribution" },
  { symbol: "TATAPOWER.NS", companyName: "Tata Power Company", exchange: "NSE", sector: "Energy", industry: "Power" },
  { symbol: "ATGL.NS", companyName: "Adani Total Gas Limited", exchange: "NSE", sector: "Energy", industry: "Gas Distribution" },
  { symbol: "MGL.NS", companyName: "Mahanagar Gas Limited", exchange: "NSE", sector: "Energy", industry: "Gas Distribution" },
  // Chemicals
  { symbol: "PIIND.NS", companyName: "PI Industries Limited", exchange: "NSE", sector: "Chemicals", industry: "Agrochemicals" },
  { symbol: "SRF.NS", companyName: "SRF Limited", exchange: "NSE", sector: "Chemicals", industry: "Specialty Chemicals" },
  // Logistics & Travel
  { symbol: "CONCOR.NS", companyName: "Container Corporation of India", exchange: "NSE", sector: "Logistics", industry: "Rail Logistics" },
  { symbol: "IRCTC.NS", companyName: "Indian Railway Catering & Tourism", exchange: "NSE", sector: "Logistics", industry: "Travel & Tourism" },
  { symbol: "INDHOTEL.NS", companyName: "Indian Hotels Company", exchange: "NSE", sector: "Consumer", industry: "Hotels & Hospitality" },
  // New Economy
  { symbol: "ZOMATO.NS", companyName: "Zomato Limited", exchange: "NSE", sector: "Consumer", industry: "Food Delivery" },
  // Defense
  { symbol: "HAL.NS", companyName: "Hindustan Aeronautics Limited", exchange: "NSE", sector: "Defense", industry: "Aerospace & Defense" },
  { symbol: "BEL.NS", companyName: "Bharat Electronics Limited", exchange: "NSE", sector: "Defense", industry: "Electronics" },
  { symbol: "BEML.NS", companyName: "Bharat Earth Movers Limited", exchange: "NSE", sector: "Defense", industry: "Engineering" },
  // Telecom Infra
  { symbol: "INDUSTOWER.NS", companyName: "Indus Towers Limited", exchange: "NSE", sector: "Telecom", industry: "Telecom Infrastructure" },
  // Insurance
  { symbol: "LICI.NS", companyName: "Life Insurance Corporation of India", exchange: "NSE", sector: "Financial Services", industry: "Insurance" },
  // Commodities
  { symbol: "RENUKA.NS", companyName: "Renuka Sugars Limited", exchange: "NSE", sector: "Commodities", industry: "Sugar" },

  // ── Global Macro (Forex & Commodities) ──────────────────────────────────
  { symbol: "USDINR=X", companyName: "USD/INR", exchange: "NSE", sector: "Currency", industry: "Forex" },
  { symbol: "GBPINR=X", companyName: "GBP/INR", exchange: "NSE", sector: "Currency", industry: "Forex" },
  { symbol: "GC=F", companyName: "GOLD", exchange: "NSE", sector: "Commodities", industry: "Gold" },
  { symbol: "CL=F", companyName: "CRUDE OIL", exchange: "NSE", sector: "Commodities", industry: "Oil" },
  { symbol: "SI=F", companyName: "SILVER", exchange: "NSE", sector: "Commodities", industry: "Silver" },
];

const INTRADAY_SYNC_MINUTES = 5;

interface YahooQuote {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

interface StockRow {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function calculateSMA(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function calculateEMA(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(values: number[], period = 14): number | undefined {
  if (values.length <= period) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(values: number[]) {
  const ema12 = calculateEMA(values, 12);
  const ema26 = calculateEMA(values, 26);
  if (ema12 === undefined || ema26 === undefined) return undefined;
  return ema12 - ema26;
}

/**
 * Detect whether rows represent 15m, 1h, or 1d candles.
 *
 * Uses the median gap rather than just rows[1]-rows[0]: consecutive candles
 * straddling an overnight or weekend break are hours or days apart, so a single
 * sample at the start of the series can misclassify intraday data as daily and
 * silently swap in the wrong indicator periods.
 */
function detectInterval(rows: StockRow[]): '15m' | '1h' | '1d' {
  if (rows.length < 2) return '1d';

  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].timestamp.getTime() - rows[i - 1].timestamp.getTime();
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return '1d';

  gaps.sort((a, b) => a - b);
  const medianMs = gaps[Math.floor(gaps.length / 2)];

  if (medianMs <= 20 * 60 * 1000) return '15m';
  if (medianMs <= 75 * 60 * 1000) return '1h';
  return '1d';
}

/** VWAP — Volume Weighted Average Price */
function calculateVWAP(rows: StockRow[]): number | undefined {
  let tpv = 0;
  let totalVol = 0;
  for (const row of rows) {
    const tp = (row.high + row.low + row.close) / 3;
    tpv += tp * row.volume;
    totalVol += row.volume;
  }
  return totalVol > 0 ? tpv / totalVol : undefined;
}

/** Bollinger Bands — returns %B (0=lower band, 1=upper band) */
function calculateBollingerPct(values: number[], period = 20, stdDevMult = 2): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMult * stdDev;
  const lower = middle - stdDevMult * stdDev;
  const bandwidth = upper - lower;
  if (bandwidth === 0) return 0.5;
  return (values[values.length - 1] - lower) / bandwidth;
}

/** ADX — Average Directional Index (trend strength, 0-100) */
function calculateADX(rows: StockRow[], period = 14): number | undefined {
  if (rows.length < period * 2 + 1) return undefined;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < rows.length; i++) {
    const upMove = rows[i].high - rows[i - 1].high;
    const downMove = rows[i - 1].low - rows[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const hl = rows[i].high - rows[i].low;
    const hc = Math.abs(rows[i].high - rows[i - 1].close);
    const lc = Math.abs(rows[i].low - rows[i - 1].close);
    trs.push(Math.max(hl, hc, lc));
  }

  // Wilder's smoothed initial sums
  let sPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let sMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let sTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    sPlusDM = sPlusDM - sPlusDM / period + plusDM[i];
    sMinusDM = sMinusDM - sMinusDM / period + minusDM[i];
    sTR = sTR - sTR / period + trs[i];
    if (sTR === 0) continue;
    const plusDI = 100 * sPlusDM / sTR;
    const minusDI = 100 * sMinusDM / sTR;
    const diSum = plusDI + minusDI;
    if (diSum === 0) continue;
    dxValues.push(Math.abs(plusDI - minusDI) / diSum * 100);
  }

  if (dxValues.length < period) return undefined;
  return dxValues.slice(-period).reduce((a, b) => a + b, 0) / period;
}

async function fetchYahooHistoricalOnce(symbol: string, range = "1mo", interval = "1d"): Promise<StockRow[] | null> {
  // encodeURIComponent handles symbols like M&M.NS → M%26M.NS in the path segment
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const response = await axios.get(url, {
    params: {
      range,
      interval,
      events: "div|split",
    },
    timeout: 20_000,
  });
  const result = response.data?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp as number[];
  const quote = (result.indicators.quote?.[0] as YahooQuote) || null;
  if (!timestamps || !quote) return null;

  const rows: StockRow[] = timestamps.map((unix, idx) => ({
    timestamp: new Date(unix * 1000),
    open: quote.open[idx] ?? 0,
    high: quote.high[idx] ?? 0,
    low: quote.low[idx] ?? 0,
    close: quote.close[idx] ?? 0,
    volume: quote.volume[idx] ?? 0,
  }))
    .filter((row) => row.close && row.volume > 0)
    .slice(-200);

  return rows.length > 0 ? rows : null;
}

/** Fetch with exponential backoff retry (3 attempts: 1s, 2s, 4s). Audit #7 fix. */
async function fetchYahooHistorical(symbol: string, range = "1mo", interval = "1d"): Promise<StockRow[] | null> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchYahooHistoricalOnce(symbol, range, interval);
    } catch (error: any) {
      const status = error?.response?.status;
      // Don't retry 404s or client errors (except 429 rate limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        console.warn(`[StockSync] ${symbol}: HTTP ${status} — not retrying`);
        return null;
      }
      if (attempt < MAX_RETRIES - 1) {
        const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[StockSync] ${symbol}: attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.warn(`[StockSync] ${symbol}: all ${MAX_RETRIES} attempts failed:`, error?.message ?? error);
        return null;
      }
    }
  }
  return null;
}

async function fetchYahooIntraday(symbol: string): Promise<StockRow[] | null> {
  const intraday = await fetchYahooHistorical(symbol, "5d", "15m");
  if (intraday && intraday.length >= 20) {
    return intraday;
  }

  // Fallback to 1h or daily if 15m data is unavailable.
  const fallback = await fetchYahooHistorical(symbol, "1mo", "1h");
  if (fallback && fallback.length >= 20) {
    return fallback;
  }

  return await fetchYahooHistorical(symbol, "3mo", "1d");
}

async function computePredictionJS(rows: StockRow[], stockId: number, sentimentScore: number, niftyMomentum = 0) {
  const interval = detectInterval(rows);
  const isIntraday = interval === '15m' || interval === '1h';

  // Interval-calibrated periods — fixes RSI(14) being only 3.5h on 15m data
  const rsiPeriod   = isIntraday ? 7  : 14;
  const smaFast     = isIntraday ? 9  : 20;
  const smaSlow     = isIntraday ? 21 : 50;
  const bbPeriod    = isIntraday ? 20 : 20;

  const closes = rows.map((row) => row.close);
  const latest = closes[closes.length - 1];
  const prior  = closes[closes.length - 2] ?? latest;

  // Core indicators
  const smaF = calculateSMA(closes, smaFast);
  const smaS = calculateSMA(closes, smaSlow);
  const rsi  = calculateRSI(closes, rsiPeriod);
  const macd = calculateMACD(closes);
  const vwap = calculateVWAP(rows);
  const bbPct = calculateBollingerPct(closes, bbPeriod);
  const adx  = calculateADX(rows);

  const momentum = prior > 0 ? (latest - prior) / prior : 0;

  // ── Individual signal scores (0–100 bullish) ───────────────────────────────

  // RSI: <30=oversold(bullish), >70=overbought(bearish), calibrated per period
  const oversoldThresh   = isIntraday ? 35 : 30;
  const overboughtThresh = isIntraday ? 65 : 70;
  const rsiVal = rsi ?? 50;
  let rsiScore: number;
  // Both branches are clamped into 0–100. The bullish branch previously had no
  // upper bound, so a deeply oversold RSI produced scores above 100 and skewed
  // the weighted composite.
  if (rsiVal < oversoldThresh) rsiScore = Math.min(100, 75 + (oversoldThresh - rsiVal));   // oversold = bullish
  else if (rsiVal > overboughtThresh) rsiScore = Math.max(0, 25 - (rsiVal - overboughtThresh)); // overbought = bearish
  else rsiScore = 50; // neutral zone

  // SMA cross: fast above slow = bullish
  const smaRatio = (smaF ?? latest) / (smaS ?? latest);
  const smaScore = Math.round(Math.min(100, Math.max(0, (smaRatio - 0.97) / 0.06 * 100)));

  // MACD: positive histogram = bullish
  const macdVal = macd ?? 0;
  const macdNorm = latest > 0 ? macdVal / latest : 0;
  const macdScore = Math.round(Math.min(100, Math.max(0, 50 + macdNorm * 2000)));

  // VWAP: price below VWAP = potential mean-reversion BUY (for intraday)
  let vwapScore = 50;
  if (vwap && latest > 0) {
    const vwapDev = (latest - vwap) / vwap;
    // Below VWAP slightly = buying opportunity; well above = take profit zone
    vwapScore = Math.round(Math.min(100, Math.max(0, 50 - vwapDev * 600)));
  }

  // Bollinger %B: <0.2=near lower band(bullish), >0.8=near upper band(bearish)
  let bbScore = 50;
  if (bbPct !== undefined) {
    bbScore = Math.round(Math.min(100, Math.max(0, (1 - bbPct) * 100)));
  }

  // Nifty relative: if stock outperforms index, add bullish bias
  const niftyScore = Math.round(Math.min(100, Math.max(0, 50 + (momentum - niftyMomentum) * 1000)));

  // Sentiment (0–100 from DB)
  const sentimentScore100 = Math.max(0, Math.min(100, sentimentScore));

  // ── Weighted composite ────────────────────────────────────────────────────
  // Intraday: VWAP + BB carry more weight; sentiment less
  const weights = isIntraday
    ? { rsi: 0.20, sma: 0.15, macd: 0.20, vwap: 0.20, bb: 0.15, nifty: 0.05, sentiment: 0.05 }
    : { rsi: 0.20, sma: 0.20, macd: 0.20, vwap: 0.05, bb: 0.15, nifty: 0.10, sentiment: 0.10 };

  const technicalScore = Math.round(
    rsiScore   * weights.rsi   +
    smaScore   * weights.sma   +
    macdScore  * weights.macd  +
    vwapScore  * weights.vwap  +
    bbScore    * weights.bb    +
    niftyScore * weights.nifty +
    sentimentScore100 * weights.sentiment
  );

  // ── ADX trend filter: reduce confidence in choppy markets ─────────────────
  const adxVal = adx ?? 25; // assume moderate trend if ADX unavailable
  const trendMultiplier = adxVal < 20 ? 0.6   // weak trend — reduce conviction
    : adxVal < 25 ? 0.8                        // moderate
    : 1.0;                                     // strong trend — full conviction

  // ── Signal determination ──────────────────────────────────────────────────
  // Use multi-confirmation: need at least 2 indicators to agree
  // VWAP confirmation must be mutually exclusive. The previous thresholds
  // (`latest < vwap * 1.005` for bullish, `latest > vwap * 0.995` for bearish)
  // overlapped, so any price within ±0.5% of VWAP — the most common case —
  // counted toward BOTH tallies and defeated the "two indicators must agree"
  // gate. Price must now sit clearly on one side of the band.
  const vwapBullish = vwap !== undefined && latest < vwap * 0.995;
  const vwapBearish = vwap !== undefined && latest > vwap * 1.005;

  const bullishCount = [
    rsiScore > 60,
    smaScore > 55,
    macdScore > 55,
    bbPct !== undefined ? bbPct < 0.3 : false,
    vwapBullish,
  ].filter(Boolean).length;

  const bearishCount = [
    rsiScore < 40,
    smaScore < 45,
    macdScore < 45,
    bbPct !== undefined ? bbPct > 0.7 : false,
    vwapBearish,
  ].filter(Boolean).length;

  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  if (technicalScore > 58 && bullishCount >= 2 && rsiVal < overboughtThresh) signal = "BUY";
  else if (technicalScore < 42 && bearishCount >= 2 && rsiVal > oversoldThresh) signal = "SELL";

  // Predicted price: momentum-adjusted with sentiment tilt
  const sentimentMultiplier = (sentimentScore - 50) / 50;
  const adjustedMomentum = momentum * (1 + sentimentMultiplier * 0.25);
  const predictedPrice = parseFloat((latest * (1 + Math.min(Math.max(adjustedMomentum, -0.03), 0.03))).toFixed(2));

  const strength = Math.round(
    Math.min(100, Math.max(5,
      Math.abs(technicalScore - 50) * trendMultiplier * 1.5 + 5
    ))
  );

  return {
    signal,
    strength,
    technicalScore,
    sentimentScore,
    rsi: rsiVal,
    macd: macdVal,
    sma20: smaF ?? latest,
    sma50: smaS ?? latest,
    predictedPrice,
  };
}

/**
 * Per-cycle context, resolved once in syncStockMarketData and threaded through
 * every stock in the batch.
 *
 * `mlHealthy` and `marketPcr` were previously fetched inside computePrediction,
 * i.e. once per stock — roughly 120 redundant health checks and option-chain
 * lookups every 5-minute cycle.
 */
interface SyncCycleContext {
  niftyMomentum: number;
  mlHealthy: boolean;
  marketPcr: number;
}

async function computePrediction(
  rows: StockRow[],
  stockId: number,
  symbol: string,
  cycle: SyncCycleContext,
) {
  // Always compute base indicators — used for rsi/macd/sma fields regardless of ML path
  const interval = detectInterval(rows);
  const isIntraday = interval === '15m' || interval === '1h';
  const closes = rows.map((row) => row.close);
  const latest = closes[closes.length - 1];
  const rsi = calculateRSI(closes, isIntraday ? 7 : 14) ?? 0;
  const macd = calculateMACD(closes) ?? 0;
  const sma20 = calculateSMA(closes, isIntraday ? 9 : 20) ?? latest;
  const sma50 = calculateSMA(closes, isIntraday ? 21 : 50) ?? latest;

  // null means no sentiment data; default to neutral (50) for calculations
  const sentimentScore = (await getAverageSentimentScore(stockId, 24)) ?? 50;

  // ── Try Python ML service first ──────────────────────────────────────────
  try {
    if (cycle.mlHealthy) {
      const latestData = rows.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }));

      const mlResult = await mlServiceClient.predict({
        stock_id: stockId,
        symbol,
        latest_data: latestData,
        sentiment_score: sentimentScore,
        market_pcr: cycle.marketPcr,
      });

      console.log(`[ML] ${symbol} → ${mlResult.signal} (${mlResult.confidence.toFixed(1)}% conf, via Python service)`);

      return {
        signal: mlResult.signal,
        strength: Math.round(mlResult.confidence),
        technicalScore: mlResult.technical_score,
        sentimentScore: mlResult.sentiment_score,
        rsi,
        macd,
        sma20,
        sma50,
        predictedPrice: mlResult.predicted_price,
      };
    }
  } catch {
    // Python ML service unavailable — fall through to JS implementation
  }

  // ── Fallback: pure JS technical analysis ─────────────────────────────────
  return computePredictionJS(rows, stockId, sentimentScore, cycle.niftyMomentum);
}

async function ensureDefaultStocks() {
  // Always upsert — ensures new stocks added to DEFAULT_STOCKS get seeded on restart
  for (const stock of DEFAULT_STOCKS) {
    await upsertStock({
      symbol: stock.symbol,
      companyName: stock.companyName,
      exchange: stock.exchange,
      sector: stock.sector,
      industry: stock.industry,
    });
  }
}

// Exported for on-demand quick preview in stockRouter
// Tries Python ML service first for best accuracy, falls back to JS (Audit #17)
export async function generateQuickPreview(symbol: string) {
  const yahooSymbol = symbol.endsWith(".NS") ? symbol : `${symbol}.NS`;
  const rows = await fetchYahooIntraday(yahooSymbol);
  if (!rows || rows.length < 14) return null;
  const latestRow = rows[rows.length - 1];
  const prevRow = rows[rows.length - 2] ?? latestRow;

  // Try the ML service, fall back to the JS model on any failure.
  // No separate health check: this path is already wrapped in a try/catch that
  // falls back, so probing /health first only added a round-trip to every
  // on-demand preview without changing the outcome.
  let prediction: Awaited<ReturnType<typeof computePredictionJS>>;
  try {
    const latestData = rows.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
    const mlResult = await mlServiceClient.predict({
      stock_id: 0,
      symbol: yahooSymbol,
      latest_data: latestData,
      sentiment_score: 50,
    });
    const closes = rows.map((r) => r.close);
    const interval = detectInterval(rows);
    const isIntraday = interval === '15m' || interval === '1h';
    prediction = {
      signal: mlResult.signal as "BUY" | "SELL" | "HOLD",
      strength: Math.round(mlResult.confidence),
      technicalScore: mlResult.technical_score,
      sentimentScore: mlResult.sentiment_score,
      rsi: calculateRSI(closes, isIntraday ? 7 : 14) ?? 0,
      macd: calculateMACD(closes) ?? 0,
      sma20: calculateSMA(closes, isIntraday ? 9 : 20) ?? latestRow.close,
      sma50: calculateSMA(closes, isIntraday ? 21 : 50) ?? latestRow.close,
      predictedPrice: mlResult.predicted_price,
    };
  } catch {
    prediction = await computePredictionJS(rows, 0, 50);
  }

  return {
    symbol: yahooSymbol,
    lastPrice: latestRow.close,
    change: latestRow.close - prevRow.close,
    percentChange: prevRow.close > 0 ? ((latestRow.close - prevRow.close) / prevRow.close) * 100 : 0,
    open: latestRow.open,
    high: latestRow.high,
    low: latestRow.low,
    volume: latestRow.volume,
    signal: prediction.signal,
    strength: prediction.strength,
    rsi: prediction.rsi,
    macd: prediction.macd,
    sma20: prediction.sma20,
    sma50: prediction.sma50,
    predictedPrice: prediction.predictedPrice,
    technicalScore: prediction.technicalScore,
    sentimentScore: prediction.sentimentScore,
    isPreview: true as const,
  };
}



const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 2000;

/** Fetch Nifty 50 index momentum — used as FII/DII macro proxy */
async function fetchNiftyMomentum(): Promise<number> {
  try {
    const rows = await fetchYahooHistorical('^NSEI', '5d', '15m');
    if (!rows || rows.length < 2) return 0;
    const latest = rows[rows.length - 1].close;
    const prior  = rows[rows.length - 2].close;
    return prior > 0 ? (latest - prior) / prior : 0;
  } catch {
    return 0;
  }
}

async function syncSingleStock(stock: { id: number; symbol: string; companyName: string }, cycle: SyncCycleContext) {
  const rows = await fetchYahooIntraday(stock.symbol);
  if (!rows || rows.length < 14) return;
    const latestRow = rows[rows.length - 1];

    const prevClose = rows[rows.length - 2]?.close ?? 0;
    const priceChange = latestRow.close - prevClose;
    const pctChange = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;

    await insertStockPrice({
      stockId: stock.id,
      lastPrice: latestRow.close,
      open: latestRow.open,
      high: latestRow.high,
      low: latestRow.low,
      previousClose: prevClose || undefined,
      volume: latestRow.volume,
      change: priceChange,
      percentChange: pctChange,
      // Use the candle's own close time, not wall-clock: history queries and
      // SMC candle ordering both key off this value.
      timestamp: latestRow.timestamp.toISOString(),
    });

    const prediction = await computePrediction(rows, stock.id, stock.symbol, cycle);

    // Always insert — strength/confidence can change even when signal stays the same
    await insertPrediction({
      stockId: stock.id,
      signal: prediction.signal,
      strength: prediction.strength,
      technicalScore: prediction.technicalScore,
      sentimentScore: prediction.sentimentScore,
      rsi: prediction.rsi,
      macd: prediction.macd,
      sma20: prediction.sma20,
      sma50: prediction.sma50,
      predictedPrice: prediction.predictedPrice,
      timestamp: new Date().toISOString(),
    });

    broadcastPredictionUpdate(stock.id, {
      stockId: stock.id,
      signal: prediction.signal,
      confidence: prediction.strength / 100, // normalize to 0-1 for UI
      price: latestRow.close,
      target: prediction.predictedPrice,
      timestamp: new Date().toISOString(),
    });

    broadcastLiveUpdate({
      stockId: stock.id,
      symbol: stock.symbol,
      lastPrice: latestRow.close,
      change: latestRow.close - rows[rows.length - 2]?.close,
      percentChange: rows[rows.length - 2]?.close
        ? ((latestRow.close - rows[rows.length - 2].close) / rows[rows.length - 2].close) * 100
        : 0,
      open: latestRow.open,
      high: latestRow.high,
      low: latestRow.low,
      volume: latestRow.volume,
      signal: prediction.signal,
      strength: prediction.strength,
      predictedPrice: prediction.predictedPrice,
      rsi: prediction.rsi ?? 0,
      macd: prediction.macd ?? 0,
      sma20: prediction.sma20 ?? latestRow.close,
      sma50: prediction.sma50 ?? latestRow.close,
      timestamp: new Date().toISOString(),
      smc: await (async () => {
        const report = await generateSMCReport(stock.id, stock.symbol, rows.map(r => ({
          open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, timestamp: r.timestamp.toISOString()
        })));
        smcCache.set(stock.id, report);
        return report;
      })()
    });

    // await createAlertsForStock(stock.id, prediction.signal, prediction.strength);

    // ── Fibonacci-EMA Agent: run after each sync, fire SSE alert if in zone ──
    try {
      const fibCandles = rows.map(r => ({
        timestamp: r.timestamp.toISOString(),
        open: r.open, high: r.high, low: r.low,
        close: r.close, volume: r.volume,
      }));
      const fibVote = runFibonacciAgent(fibCandles, latestRow.close);
      if (fibVote.alertTier !== 'NONE') {
        const nearestFib = fibVote.fibLevels.reduce((best, level) =>
          Math.abs(level.price - latestRow.close) < Math.abs(best.price - latestRow.close) ? level : best,
          fibVote.fibLevels[0]
        );
        broadcastFibAlert({
          stockId: stock.id,
          symbol: stock.symbol,
          alertTier: fibVote.alertTier as 'APPROACHING' | 'AT_ZONE' | 'TRIGGERED',
          signal: fibVote.signal,
          fibLevel: nearestFib?.label ?? '',
          fibPrice: nearestFib?.price ?? latestRow.close,
          confluenceStrength: fibVote.nearestZone?.strength ?? 1,
          candlePattern: fibVote.candlePattern.name,
          emaPeriod: fibVote.nearestZone?.emaPeriod ?? null,
          entryZone: fibVote.entryZone,
          stopLoss: fibVote.stopLoss,
          target1: fibVote.target1,
          riskReward: fibVote.riskReward,
          reasoning: fibVote.reasoning,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (fibErr) {
      // Non-fatal — Fibonacci agent errors must never break the main sync
      console.warn(`[FibAgent] ${stock.symbol} analysis failed:`, fibErr);
    }
}

async function syncStockMarketData() {
  const stocks = await getAllStocks();

  // Resolve the whole per-cycle context up front. All three of these are
  // market-wide, not per-stock: fetching them inside the per-stock path meant
  // one Nifty fetch, one ML health check and one option-chain lookup for every
  // symbol in the universe on every cycle.
  const [niftyMomentum, mlHealthy, optionWalls] = await Promise.all([
    fetchNiftyMomentum(),
    mlServiceClient.healthCheck().catch(() => false),
    optionsService.fetchOptionWalls().catch(() => null),
  ]);

  const cycle: SyncCycleContext = {
    niftyMomentum,
    mlHealthy,
    // Only a real option chain is allowed to move confidence. A simulated
    // chain, or none at all, reports PCR_NEUTRAL, which falls between the
    // bullish (>1.1) and bearish (<0.85) branches in the ML service.
    marketPcr: optionWalls && !optionWalls.isSimulated ? optionWalls.pcr : PCR_NEUTRAL,
  };

  if (!mlHealthy) {
    console.log('[StockSync] ML service unavailable — using JS technical fallback for this cycle.');
  }

  // Process in batches of BATCH_SIZE to avoid Yahoo Finance rate limits
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((stock) => syncSingleStock(stock, cycle)));
    if (i + BATCH_SIZE < stocks.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  console.log(`[StockSync] Synced ${stocks.length} stocks in ${Math.ceil(stocks.length / BATCH_SIZE)} batches (Nifty momentum: ${(niftyMomentum * 100).toFixed(3)}%).`);
  invalidateRankedCache();
}

export async function startStockSyncService() {
  // Seed default stocks once at startup — not on every sync cycle
  await ensureDefaultStocks();
  // First sync runs immediately so the Dashboard is populated on boot
  await syncStockMarketData();
  // Subsequent syncs run on the interval
  setInterval(() => {
    syncStockMarketData().catch((err) => 
      console.error("[StockSync] Interval error:", err)
    );
  }, INTRADAY_SYNC_MINUTES * 60 * 1000);
}
