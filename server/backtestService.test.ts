import { describe, expect, it } from "vitest";
import {
  alignToPrices,
  calculateSMA,
  calculateRSI,
  calculateMACD,
} from "./_core/backtestService";

/**
 * Regression tests for the backtest indicator alignment.
 *
 * generateSignals previously indexed the indicator arrays with hand-written
 * offsets, one of which (`sma50[i - 30]`) resolved to a price 19 bars in the
 * future. These assertions pin the invariant that makes that impossible:
 * after alignToPrices, index i always describes prices[i].
 */

const prices = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);

describe("alignToPrices", () => {
  it("right-aligns so the last element still maps to the last price", () => {
    const sma = calculateSMA(prices, 20);
    const aligned = alignToPrices(sma, prices.length);
    expect(aligned).toHaveLength(prices.length);
    expect(aligned[aligned.length - 1]).toBe(sma[sma.length - 1]);
  });

  it("pads exactly the warm-up region with undefined", () => {
    const sma = calculateSMA(prices, 20);
    const aligned = alignToPrices(sma, prices.length);
    // SMA(20) is undefined for the first 19 bars and defined from bar 19 on.
    for (let i = 0; i < 19; i++) expect(aligned[i]).toBeUndefined();
    expect(aligned[19]).toBeDefined();
  });

  it("never returns more entries than there are prices", () => {
    expect(alignToPrices([1, 2, 3, 4, 5], 3)).toHaveLength(3);
  });
});

describe("indicator alignment invariants", () => {
  it("SMA(20) at index i equals the mean of prices[i-19..i]", () => {
    const aligned = alignToPrices(calculateSMA(prices, 20), prices.length);
    for (const i of [19, 40, 77, prices.length - 1]) {
      const expected = prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
      expect(aligned[i]).toBeCloseTo(expected, 10);
    }
  });

  it("SMA(50) at index i equals the mean of prices[i-49..i] — the look-ahead regression", () => {
    const aligned = alignToPrices(calculateSMA(prices, 50), prices.length);
    for (const i of [49, 80, prices.length - 1]) {
      const expected = prices.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50;
      expect(aligned[i]).toBeCloseTo(expected, 10);
    }
    // The old code read sma50[i - 30]. Show that this is a *different*, later
    // bar's value — i.e. it genuinely leaked future information.
    const raw = calculateSMA(prices, 50);
    const i = 80;
    expect(raw[i - 30]).not.toBeCloseTo(raw[i - 49], 6);
    // Specifically, raw[i-30] is the SMA anchored 19 bars ahead of bar i.
    const nineteenAhead = prices.slice(i + 19 - 49, i + 19 + 1).reduce((a, b) => a + b, 0) / 50;
    expect(raw[i - 30]).toBeCloseTo(nineteenAhead, 10);
  });

  it("SMA(50) warm-up covers exactly 49 bars", () => {
    const aligned = alignToPrices(calculateSMA(prices, 50), prices.length);
    for (let i = 0; i < 49; i++) expect(aligned[i]).toBeUndefined();
    expect(aligned[49]).toBeDefined();
  });

  it("RSI(14) warm-up covers exactly 14 bars", () => {
    const aligned = alignToPrices(calculateRSI(prices), prices.length);
    expect(calculateRSI(prices)).toHaveLength(prices.length - 14);
    for (let i = 0; i < 14; i++) expect(aligned[i]).toBeUndefined();
    expect(aligned[14]).toBeDefined();
  });

  it("MACD warm-up covers exactly 25 bars", () => {
    const aligned = alignToPrices(calculateMACD(prices), prices.length);
    expect(calculateMACD(prices)).toHaveLength(prices.length - 25);
    for (let i = 0; i < 25; i++) expect(aligned[i]).toBeUndefined();
    expect(aligned[25]).toBeDefined();
  });

  it("every aligned series agrees on the final bar", () => {
    const n = prices.length;
    const series = [
      alignToPrices(calculateSMA(prices, 20), n),
      alignToPrices(calculateSMA(prices, 50), n),
      alignToPrices(calculateRSI(prices), n),
      alignToPrices(calculateMACD(prices), n),
    ];
    for (const s of series) {
      expect(s).toHaveLength(n);
      expect(s[n - 1]).toBeDefined();
    }
  });
});
