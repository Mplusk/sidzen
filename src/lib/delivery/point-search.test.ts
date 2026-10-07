import { describe, expect, it } from "vitest";
import { pointSearchTerms } from "./point-search";
describe("pickup address search terms", () => {
  it("accepts partial words, arbitrary word order and separators in house numbers", () => {
    expect(pointSearchTerms("Омск, Бульварная 20/2")).toEqual(["омск", "бульварная", "20", "2"]);
    expect(pointSearchTerms("Бульвар Омс")).toEqual(["бульвар", "омс"]);
  });
  it("normalizes Cyrillic case, ё and duplicate terms", () => {
    expect(pointSearchTerms("Орёл орел БЕРЁЗОВАЯ")).toEqual(["орел", "березовая"]);
  });
  it("removes SQL wildcard characters and rejects empty or excessive token lists", () => {
    expect(pointSearchTerms("%__'")).toEqual([]);
    expect(pointSearchTerms("а б")).toEqual([]);
    expect(pointSearchTerms(Array.from({ length: 13 }, (_, i) => `слово${i}`).join(" "))).toEqual([]);
  });
});
