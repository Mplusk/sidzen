import { describe, expect, it } from "vitest";
import { defaultSelection, priceProduct, configurationText, type ProductOptions } from "./product-options";
const product: ProductOptions = {
  id: "p1", name: "Товар", basePrice: 1000, weightGrams: 100, stock: 10, madeToOrder: true,
  materials: [{ id: "m1", slug: "pla", name: "PLA", pricePerGram: 3 }, { id: "m2", slug: "petg", name: "PETG", pricePerGram: 5 }],
  colors: [{ id: "c1", slug: "black", name: "Чёрный", hex: "#000000" }],
  qualities: [{ id: "q1", slug: "standard", name: "Стандарт", layerHeightMm: .2, priceMultiplier: 1 }, { id: "q2", slug: "fine", name: "Высокое", layerHeightMm: .1, priceMultiplier: 1.5 }],
  variants: [],
};
describe("shared product pricing", () => {
  it("selects the baseline and snapshots readable option names", () => {
    const quote = priceProduct(product, defaultSelection(product));
    expect(quote.unitPrice).toBe(1000);
    expect(configurationText(quote.config)).toBe("PLA · Чёрный · Стандарт · 0.2 мм");
  });
  it("charges material and quality changes and multiplies quantity", () => {
    const quote = priceProduct(product, { ...defaultSelection(product), material: "petg", quality: "fine", quantity: 3 });
    expect(quote.unitPrice).toBe(1800); expect(quote.total).toBe(5400);
  });
  it("uses an exact variant price, including color-specific pricing", () => {
    const variant = { id: "v1", materialId: "m1", colorId: "c1", qualityProfileId: "q1", price: 1234.5 };
    expect(priceProduct({ ...product, variants: [variant] }, { ...defaultSelection(product), quantity: 2 })).toMatchObject({ unitPrice: 1234.5, total: 2469, variantId: "v1" });
  });
  it("rejects tampered and removed options, negative/fractional/excessive quantity", () => {
    for (const quantity of [-1, 0, 1.5, 1000, NaN, Infinity]) expect(() => priceProduct(product, { ...defaultSelection(product), quantity })).toThrow();
    for (const key of ["material", "color", "quality"]) expect(() => priceProduct(product, { ...defaultSelection(product), [key]: "other" })).toThrow("options");
  });
  it("works without optional attributes and translates old snapshots", () => {
    const simple = { ...product, materials: [], colors: [], qualities: [] };
    expect(priceProduct(simple, defaultSelection(simple)).total).toBe(1000);
    expect(configurationText({ material: "petg", quality: "fine" })).toBe("PETG · Высокое");
    expect(configurationText(null)).toBe("");
  });
  it("uses a ratio when weight is absent and handles free base material", () => {
    expect(priceProduct({ ...product, weightGrams: 0 }, { ...defaultSelection(product), material: "petg" }).unitPrice).toBe(1667);
    const free = { ...product, materials: product.materials.map((m, i) => ({ ...m, pricePerGram: i ? 5 : 0 })) };
    expect(priceProduct(free, { ...defaultSelection(free), material: "petg" }).unitPrice).toBe(1500);
  });
});
