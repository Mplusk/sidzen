import { describe, expect, it } from "vitest";
import { defaultSelection, defaultProductPrice, priceProduct, configurationText, type ProductOptions } from "./product-options";
const product: ProductOptions = {
  id: "p1", name: "Товар", basePrice: 1000, weightGrams: 100, stock: 10, madeToOrder: true,
  materials: [{ id: "m1", slug: "pla", name: "PLA", pricePerGram: 3 }, { id: "m2", slug: "petg", name: "PETG", pricePerGram: 5 }],
  colors: [{ id: "c1", slug: "black", name: "Чёрный", hex: "#000000" }],
  qualities: [{ id: "q1", slug: "standard", name: "Стандарт", layerHeightMm: .2, priceMultiplier: 1 }, { id: "q2", slug: "fine", name: "Высокое", layerHeightMm: .1, priceMultiplier: 1.5 }],
  variants: [],
};
describe("shared product pricing", () => {
  it("quotes public prices through the same default configuration including rounding and overrides", () => {
    expect(defaultProductPrice({ ...product, basePrice: 149.99 })).toBe(150);
    expect(defaultProductPrice({ ...product, qualities: [{ ...product.qualities[0], priceMultiplier: 1.25 }] })).toBe(1250);
    expect(defaultProductPrice({ ...product, variants: [{ id: "v", materialId: "m1", colorId: "c1", qualityProfileId: "q1", price: 123.45 }] })).toBe(123.45);
  });
  it("chooses the same default regardless of relation ordering or equal material costs", () => {
    const tied = { ...product, materials: product.materials.map(m => ({ ...m, pricePerGram: 3 })),
      colors: [...product.colors, { id: "c2", slug: "white", name: "Белый", hex: "#fff" }],
      qualities: product.qualities.map(q => ({ ...q, slug: q.slug === "standard" ? "normal" : q.slug })),
    };
    const reversed = { ...tied, materials: [...tied.materials].reverse(), colors: [...tied.colors].reverse(), qualities: [...tied.qualities].reverse() };
    expect(defaultSelection(tied)).toEqual(defaultSelection(reversed));
    expect(defaultProductPrice(tied)).toBe(defaultProductPrice(reversed));
    expect(defaultSelection(tied)).toMatchObject({ material: "petg", color: "white", quality: "normal" });
  });
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
