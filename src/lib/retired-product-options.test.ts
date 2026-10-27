import { describe, expect, it } from "vitest";
import { currentProductSpecifications, isRetiredProductSpecification } from "./retired-product-options";
import { defaultSelection, priceProduct, type ProductOptions } from "./product-options";
import { parseCatalogCreate, parseCatalogDelete } from "./catalog-admin";

describe("retired manufacturing choices", () => {
  it.each(["Технологии", "Технология печати", "technology", "Качество печати", "qualityProfile", "Постобработка", "postProcesses", "Высота слоя, мм", "layerHeightMm"])("removes %s without hiding material, color or unrelated quality facts", key => {
    expect(isRetiredProductSpecification(key)).toBe(true);
    expect(currentProductSpecifications({ [key]: "legacy", Материал: "PLA", Цвет: "Белый", "Качество поверхности": "Гладкая", ТНВЭД: "3926" })).toEqual({ Материал: "PLA", Цвет: "Белый", "Качество поверхности": "Гладкая", ТНВЭД: "3926" });
  });
  it.each(["technology", "quality", "postProcess"])("rejects stale dictionary actions for %s", kind => {
    const form = new FormData(); form.set("kind", kind); form.set("id", "old"); form.set("name", "Legacy");
    expect(parseCatalogCreate(form).success).toBe(false);
    expect(parseCatalogDelete(form).success).toBe(false);
  });
  it("ignores legacy quality selections, modifiers and quality-specific variants", () => {
    const product = { id: "p", name: "P", basePrice: 240, stock: 1, weightGrams: 100, madeToOrder: false, materials: [], colors: [],
      qualities: [{ id: "fine", slug: "fine", priceMultiplier: 20 }], variants: [{ id: "v", materialId: null, colorId: null, qualityProfileId: "fine", price: 9999 }] } satisfies ProductOptions & { qualities: unknown[] };
    const stale = { ...defaultSelection(product), quality: "fine", technology: "sla", postProcesses: ["painting"] };
    const quote = priceProduct(product, stale);
    expect(quote.unitPrice).toBe(240);
    expect(quote.variantId).toBeUndefined();
    expect(quote.config).toEqual({ material: "", materialName: "", color: "", colorName: "" });
    expect(defaultSelection(product)).toEqual({ material: "", color: "", quantity: 1 });
  });
});
