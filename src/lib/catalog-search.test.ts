import { describe, expect, it } from "vitest";
import { filterValues, priceBound, searchTerms } from "./catalog-search";
import { pluralRu, translatedSpecifications } from "./format";
describe("catalog search and presentation", () => {
  it("matches Russian endings and synonyms", () => { expect(searchTerms("подставки")[0]).toContain("держател"); expect(searchTerms("проводов")[0]).toContain("кабел"); expect(searchTerms("органайзеры")[0]).toContain("органайзер"); });
  it("limits input and handles invalid query prices and filters", () => { expect(filterValues("pla,petg,pla,../x")).toEqual(["pla", "petg"]); for (const value of ["NaN", "Infinity", "-1", ""]) expect(priceBound(value)).toBeUndefined(); expect(priceBound("100")).toBe(100); expect(searchTerms(" ".repeat(200))).toEqual([]); });
  it("uses Russian plurals and translated unique specification keys", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => pluralRu(n, ["товар", "товара", "товаров"]))).toEqual(["товар", "товара", "товаров", "товаров", "товар", "товара", "товаров"]);
    expect(translatedSpecifications({ layer: "0.2", tolerance: "0.3", technology: "FDM" })).toEqual({ "Высота слоя": "0.2", "Допуск": "0.3" });
  });
});
