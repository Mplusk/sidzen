import { describe, expect, it } from "vitest";
import { calculatePrintQuote } from "@/lib/pricing";

describe("calculatePrintQuote", () => {
  it("applies minimum order and rounds to tens", () => {
    const quote = calculatePrintQuote({ volumeCm3: 1, densityGcm3: 1.24, materialPricePerGram: 7.5, infillPercent: 20, qualityMultiplier: 1, minimumOrder: 650, setupFee: 250 });
    expect(quote.unitPrice).toBe(650);
    expect(quote.total).toBe(650);
    expect(quote.isPreliminary).toBe(true);
  });

  it("scales volume cubically and gives a bulk discount", () => {
    const single = calculatePrintQuote({ volumeCm3: 100, densityGcm3: 1.24, materialPricePerGram: 8, infillPercent: 40, qualityMultiplier: 1, quantity: 1, scale: 1 });
    const scaled = calculatePrintQuote({ volumeCm3: 100, densityGcm3: 1.24, materialPricePerGram: 8, infillPercent: 40, qualityMultiplier: 1, quantity: 10, scale: 2 });
    expect(scaled.scaledVolumeCm3).toBe(800);
    expect(scaled.total).toBeLessThan(scaled.unitPrice * 10);
    expect(scaled.estimatedWeightGrams).toBeGreaterThan(single.estimatedWeightGrams * 7.9);
  });
});
