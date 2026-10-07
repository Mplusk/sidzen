import { describe, expect, it } from "vitest";
import { pointSearchTerms, pointSearchPattern, pointSearchQuery } from "./point-search";
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
  it("matches word prefixes, not embedded city names, and whole house numbers", () => {
    expect(pointSearchPattern("омск")).toBe("(^|[^[:alnum:]а-я])омск");
    expect(pointSearchPattern("гагар", true)).toBe("(^|[^[:alnum:]а-я])гагар([^[:alnum:]а-я]|$)");
    expect(pointSearchPattern("20")).toBe("(^|[^[:alnum:]а-я])20([^0-9]|$)");
  });
  it("combines indexed prefixes without stemming and rejects query operators", () => {
    expect(pointSearchQuery(pointSearchTerms("ЯБЛОН гагар 190/2"))).toBe("'яблон':* & 'гагар':* & '190':* & '2':*");
    expect(() => pointSearchQuery(["город | другой"])).toThrow();
    expect(() => pointSearchQuery(["'город'"])).toThrow();
    expect(() => pointSearchQuery([])).toThrow();
  });
});
