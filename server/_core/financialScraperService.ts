import * as cheerio from "cheerio";
import axios from "axios";

/**
 * Native, high-speed web scraper to pull breaking financial news for a specific stock.
 * Bypasses the need for heavy MCP client implementations.
 */
export async function scrapeRealtimeNews(symbol: string): Promise<{ headline: string; snippet: string; url: string; time: string }[]> {
  try {
    const cleanSymbol = symbol.replace(".NS", "");
    
    // We scrape Google Finance/News directly for the absolute latest breaking data.
    // In production, you might scrape Mint, MoneyControl, or EconomicTimes.
    // We are spoofing a generic browser User-Agent to avoid immediate 403 blocks.
    const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(cleanSymbol + " share price NSE")}&hl=en-IN&gl=IN&ceid=IN:en`;
    
    const { data } = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 5000 // Ensure it doesn't hang the ML prediction
    });

    const $ = cheerio.load(data);
    const articles: { headline: string; snippet: string; url: string; time: string }[] = [];

    // Google News structure (often uses h3 or h4 for headlines and time tags)
    // This is a generic fast scrape pattern
    $("article").each((i, element) => {
      if (i >= 5) return false; // Grab top 5 most recent only
      
      const headline = $(element).find("h3, h4").text().trim() || $(element).find("a").text().trim();
      const relativeUrl = $(element).find("a").attr("href");
      const url = relativeUrl ? relativeUrl.replace("./", "https://news.google.com/") : searchUrl;
      const time = $(element).find("time").text().trim() || "Just now";
      
      // Grab snippet if available (often in div or span adjacent to title)
      const snippet = $(element).find("div").text().trim().substring(0, 150) + "...";

      if (headline && headline.length > 10) {
        articles.push({ headline, snippet, url, time });
      }
    });

    console.log(`[Scraper] Fast-scraped ${articles.length} real-time articles for ${cleanSymbol}`);
    return articles;

  } catch (error: any) {
    console.error(`[Scraper] Failed to fast-scrape ${symbol}:`, error.message);
    return [];
  }
}
