import { describe, expect, it } from "vitest";
import { specificationFacets } from "./catalog-facets";
describe("presentation-only catalog facets", () => {
  it("normalizes marketplace aliases and Russian colour spelling", () => {
    expect(specificationFacets({ "Материал изделия": "PLA пластик", "Цвет товара": "чёрный", "Материал": "PLA" })).toEqual([
      { kind: "material", slug: "pla", name: "PLA" }, { kind: "color", slug: "chernyy", name: "черный" },
    ]);
  });
  it("does not infer production technology or treat administrative fields as filters", () => {
    expect(specificationFacets({ "ТНВЭД": "123", "Описание": "3D печать PLA", "Цвет": null })).toEqual([]);
  });
  it("supports multiple colours without duplicate values", () => {
    expect(specificationFacets({ "Цвет": "белый, черный, белый" })).toHaveLength(2);
  });
});
