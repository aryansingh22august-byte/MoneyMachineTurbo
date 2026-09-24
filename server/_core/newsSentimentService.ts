import axios from "axios";
import { insertNewsSentiment } from "../db";
import { cacheSentimentData } from "./cachedSentimentService";
import { scrapeRealtimeNews } from "./financialScraperService";

// ─────────────────────────────────────────────────────────────────────────────
// FREE RSS-based news fetcher — no API key required!
// Sources: Economic Times, Moneycontrol, Business Standard, BSE India
// ─────────────────────────────────────────────────────────────────────────────

interface RssArticle {
  headline: string;
  summary: string;
  url: string;
  datetime: number; // unix timestamp (seconds)
  source: string;
}

// Company name → search term mapping for RSS queries
const COMPANY_NAME_MAP: Record<string, string> = {
  'HAL.NS': 'Hindustan Aeronautics HAL',
  'BEL.NS': 'Bharat Electronics BEL',
  'BEML.NS': 'Bharat Earth Movers BEML',
  'TATASTEEL.NS': 'Tata Steel',
  'JSWSTEEL.NS': 'JSW Steel',
  'HINDALCO.NS': 'Hindalco Industries',
  'SAIL.NS': 'Steel Authority India SAIL',
  'TATAMOTORS.NS': 'Tata Motors',
  'RELIANCE.NS': 'Reliance Industries',
  'ATGL.NS': 'Adani Total Gas',
  'JINDALSTEL.NS': 'Jindal Steel Power',
  'JINDALSTEEL.NS': 'Jindal Steel Power',
  'BPCL.NS': 'Bharat Petroleum BPCL',
  'MGL.NS': 'Mahanagar Gas',
  'PNB.NS': 'Punjab National Bank PNB',
  'IDFCFIRSTB.NS': 'IDFC First Bank',
  'RENUKA.NS': 'Renuka Sugars',
};

// ─── Groq LLM-based sentiment (Audit #8) ──────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
const GROQ_MODEL = 'qwen/qwen3.8-27b';

interface GroqSentimentResult {
  score: number;
  label: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
}

async function analyzeWithGroq(headlines: string[]): Promise<GroqSentimentResult[]> {
  if (!GROQ_API_KEY || headlines.length === 0) return [];

  const prompt = `You are a stock market sentiment classifier for Indian stocks (NSE/BSE).
Classify each headline as POSITIVE, NEGATIVE, or NEUTRAL with a score from 0-100 (0=very negative, 50=neutral, 100=very positive).

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond ONLY with valid JSON array. Example format:
[{"score": 72, "label": "POSITIVE"}, {"score": 25, "label": "NEGATIVE"}]`;

  try {
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500,
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });

    const content = resp.data?.choices?.[0]?.message?.content ?? '';
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as GroqSentimentResult[];
    // Validate and normalize
    return parsed.map(item => ({
      score: Math.max(0, Math.min(100, typeof item.score === 'number' ? item.score : 50)),
      label: (['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(item.label) ? item.label : 'NEUTRAL') as GroqSentimentResult['label'],
    }));
  } catch (err: any) {
    console.warn('[Groq Sentiment] API call failed:', err?.message ?? err);
    return [];
  }
}

// ─── Keyword-based fallback sentiment ──────────────────────────────────────
function analyzeKeywordSentiment(text: string): { score: number; label: "POSITIVE" | "NEGATIVE" | "NEUTRAL" } {
  const positiveWords = [
    "rise", "gain", "profit", "growth", "bullish", "buy", "up", "increase", "surge", "rally",
    "strong", "positive", "boost", "record", "high", "breakout", "momentum", "upgrade",
    "expansion", "acquisition", "merger", "dividend", "bonus", "beat", "outperform", "order",
  ];
  const negativeWords = [
    "fall", "loss", "decline", "bearish", "sell", "down", "decrease", "drop", "crash", "slump",
    "weak", "negative", "concern", "risk", "penalty", "fine", "scam", "fraud", "lawsuit",
    "delay", "cancellation", "shutdown", "bankruptcy", "default", "downgrade", "miss",
  ];

  const lowerText = text.toLowerCase();
  let pos = 0, neg = 0;
  positiveWords.forEach(w => { pos += (lowerText.match(new RegExp(w, 'g')) || []).length; });
  negativeWords.forEach(w => { neg += (lowerText.match(new RegExp(w, 'g')) || []).length; });

  const net = (pos - neg) / Math.max(lowerText.split(' ').length, 1);
  if (net > 0.02)  return { label: "POSITIVE", score: Math.min(Math.round(net * 50 + 50), 100) };
  if (net < -0.02) return { label: "NEGATIVE", score: Math.max(Math.round(net * 50 + 50), 0) };
  return { label: "NEUTRAL", score: 50 };
}

// ---- FREE: Google News RSS feed scraper ----
async function fetchGoogleNewsRss(symbol: string): Promise<RssArticle[]> {
  const companyTerm = COMPANY_NAME_MAP[symbol] ?? symbol.replace('.NS', '');
  const query = encodeURIComponent(`${companyTerm} stock NSE India`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;

  try {
    const response = await axios.get(rssUrl, {
      timeout: 12_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockBot/1.0)' },
    });

    const xml: string = response.data;

    // Parse RSS items without an XML library — simple regex extraction
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const sourceRegex = /<source[^>]*>(.*?)<\/source>/;

    const articles: RssArticle[] = [];
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const titleMatch = titleRegex.exec(block);
      const linkMatch = linkRegex.exec(block);
      const dateMatch = pubDateRegex.exec(block);
      const sourceMatch = sourceRegex.exec(block);

      if (titleMatch && linkMatch) {
        articles.push({
          headline: titleMatch[1].trim(),
          summary: '',
          url: linkMatch[1].trim(),
          datetime: dateMatch ? Math.floor(new Date(dateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
          source: sourceMatch ? sourceMatch[1].trim() : 'Google News',
        });
      }
    }

    return articles.slice(0, 10);
  } catch (err: any) {
    console.warn(`[NewsRSS] Failed for ${symbol}:`, err?.message ?? err);
    return [];
  }
}

// ---- FREE: Economic Times RSS feed ----
async function fetchEconomicTimesRss(symbol: string): Promise<RssArticle[]> {
  try {
    const rssUrl = `https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms`;
    const response = await axios.get(rssUrl, {
      timeout: 10_000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const xml: string = response.data;
    const companyTerm = (COMPANY_NAME_MAP[symbol] ?? symbol.replace('.NS', '')).toLowerCase().split(' ')[0];

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(.*?)<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;

    const articles: RssArticle[] = [];
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const titleMatch = titleRegex.exec(block);
      const linkMatch = linkRegex.exec(block);
      const dateMatch = pubDateRegex.exec(block);

      const title = titleMatch?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? '';

      // Only include articles mentioning this company
      if (title && title.toLowerCase().includes(companyTerm)) {
        articles.push({
          headline: title,
          summary: '',
          url: linkMatch?.[1]?.trim() ?? '',
          datetime: dateMatch ? Math.floor(new Date(dateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
          source: 'Economic Times',
        });
      }
    }

    return articles.slice(0, 5);
  } catch {
    return []; // silently skip
  }
}

let newsSentimentServiceStarted = false;
let newsSentimentRunInProgress = false;

// ---- Main export ----
export async function fetchAndAnalyzeNewsSentiment(stockId: number, symbol: string) {
  try {
    // Primary: Blazing Fast Native Scraper
    let articles: RssArticle[] = (await scrapeRealtimeNews(symbol)).map(a => ({
      ...a,
      summary: a.snippet,
      datetime: Math.floor(Date.now() / 1000), // Realtime scraping
      source: 'Google Finance (Fast Scrape)'
    }));

    // Secondary Fallback: Google News RSS (free, no key)
    if (articles.length === 0) {
      articles = await fetchGoogleNewsRss(symbol);
    }

    // Tertiary fallback: Economic Times RSS
    if (articles.length === 0) {
      articles = await fetchEconomicTimesRss(symbol);
    }

    if (articles.length === 0) return;

    // Only process last 24h articles
    const oneDayAgo = Date.now() / 1000 - 86400;
    const recent = articles.filter(a => a.datetime > oneDayAgo);
    const toProcess = recent.length > 0 ? recent : articles; // fallback to all if all old
    const batch = toProcess.slice(0, 5);

    // ── Try Groq LLM sentiment first (Audit #8) ────────────────────────────
    const headlines = batch.map(a => a.headline);
    let groqResults = await analyzeWithGroq(headlines);

    const sentiments: { score: number; label: string; source: string }[] = [];
    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      let sentiment: { score: number; label: string };

      if (groqResults.length > 0 && groqResults[i]) {
        // Groq LLM result available
        sentiment = groqResults[i];
      } else {
        // Keyword fallback
        sentiment = analyzeKeywordSentiment(article.headline + ' ' + article.summary);
      }

      sentiments.push({ score: sentiment.score, label: sentiment.label, source: article.source });
      await insertNewsSentiment({
        stockId,
        headline: article.headline,
        source: article.source,
        sentimentScore: sentiment.score,
        sentimentLabel: sentiment.label as any,
        url: article.url,
        // article.datetime is unix seconds. Without this the 24h sentiment
        // lookback (getRecentNewsSentiment) never matches and every stock
        // silently falls back to a neutral score of 50.
        publishedAt: new Date(article.datetime * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    // Cache the aggregated sentiment score for fast retrieval
    if (sentiments.length > 0) {
      const avgScore = Math.round(sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length);
      const label = avgScore > 65 ? 'POSITIVE' : avgScore < 35 ? 'NEGATIVE' : 'NEUTRAL';
      await cacheSentimentData(stockId, {
        stock_id: stockId,
        sentiment_score: avgScore,
        sentiment_label: label,
        news_count: sentiments.length,
        sources: [...new Set(sentiments.map((s) => s.source))],
        confidence: Math.min(sentiments.length * 20, 100),
        timestamp: new Date().toISOString(),
      });
    }

    const engine = groqResults.length > 0 ? 'Groq LLM' : 'keyword';
    console.log(`[NewsRSS] ✓ ${batch.length} articles processed for ${symbol} (via ${engine})`);
  } catch (error: any) {
    // Audit #16 fix: log the error, don't silently swallow
    console.warn(`[NewsSentiment] Error processing ${symbol}:`, error?.message ?? error);
  }
}

let _sentimentInterval: ReturnType<typeof setInterval> | null = null;

export async function startNewsSentimentService() {
  if (_sentimentInterval) {
    console.warn('[NewsSentiment] Service already started — ignoring duplicate start');
    return;
  }

  newsSentimentServiceStarted = true;

  const runCycle = async () => {
    if (newsSentimentRunInProgress) {
      console.warn('[NewsSentiment] Previous cycle still running, skipping this interval');
      return;
    }

    newsSentimentRunInProgress = true;
    try {
      const { getAllStocks } = await import("../db");
      const stocks = await getAllStocks();
      for (const stock of stocks) {
        await fetchAndAnalyzeNewsSentiment(stock.id, stock.symbol);
        await new Promise((resolve) => setTimeout(resolve, 800)); // gentle rate spacing
      }
    } catch (error) {
      console.error('[NewsSentiment] Error during sentiment run cycle:', error);
    } finally {
      newsSentimentRunInProgress = false;
    }
  };

  // Initial run
  void runCycle();

  // Repeat every 4 hours — stored so we can clear on shutdown
  _sentimentInterval = setInterval(() => void runCycle(), 4 * 60 * 60 * 1000);
}

export function stopNewsSentimentService() {
  if (_sentimentInterval) {
    clearInterval(_sentimentInterval);
    _sentimentInterval = null;
    newsSentimentServiceStarted = false;
  }
}
