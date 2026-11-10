import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("./product-gallery", () => ({ ProductGallery: () => createElement("div") }));
import { ProductCard } from "./product-card";
type Product = Parameters<typeof ProductCard>[0]["product"];
function product(basePrice: number, variantPrice?: number, oldPrice = 200) {
  return { id: "p", name: "Товар", slug: "p", basePrice, oldPrice, stock: 1, weightGrams: 0, madeToOrder: false,
    materials: [], colors: [], qualityProfiles: [], images: [], categories: [],
    variants: variantPrice === undefined ? [] : [{ id: "v", materialId: null, colorId: null, qualityProfileId: null, price: variantPrice }],
  } as unknown as Product;
}
it("renders the configured price and computes the discount from that price, not basePrice", () => {
  const html = renderToStaticMarkup(createElement(ProductCard, { product: product(1000, 150) }));
  expect(html).toContain("<strong>150"); expect(html).toContain("−25%"); expect(html).not.toContain("1 000");
});
it("applies the same rounding as the purchase form and hides false discounts", () => {
  expect(renderToStaticMarkup(createElement(ProductCard, { product: product(149.99) }))).toContain("<strong>150");
  const html = renderToStaticMarkup(createElement(ProductCard, { product: product(50, 300) }));
  expect(html).toContain("<strong>300"); expect(html).not.toContain("product-card__discount"); expect(html).not.toContain("<s>");
});
it("does not claim a blocked product is available", () => {
  const html = renderToStaticMarkup(createElement(ProductCard, { product: product(200), stockReviewRequired: true }));
  expect(html).toContain("Наличие уточняется");
  expect(html).not.toContain("is-available");
});

