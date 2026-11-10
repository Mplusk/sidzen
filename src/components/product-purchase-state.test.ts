// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProductOptions } from "@/lib/product-options";
vi.mock("@/app/actions/cart", () => ({ addProductToCart: vi.fn(), updateCartItem: vi.fn() }));
import { ProductPurchaseState, ProductMobilePrice } from "./product-purchase-state";
import { ProductPurchaseForm } from "./product-purchase-form";
const product: ProductOptions = { id: "bowl", name: "Чаша", basePrice: 200, weightGrams: 50, stock: 3, madeToOrder: false,
  materials: [{ id: "pla", slug: "pla", name: "PLA", pricePerGram: 1 }, { id: "petg", slug: "petg", name: "PETG", pricePerGram: 2 }],
  colors: [{ id: "black", slug: "black", name: "Чёрный", hex: "#000" }, { id: "white", slug: "white", name: "Белый", hex: "#fff" }],
  variants: [{ id: "v", materialId: "petg", colorId: "black", qualityProfileId: null, price: 350 }] };
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(value = product, editing = false) {
  await act(async () => root.render(createElement(ProductPurchaseState, { key: value.id, product: value }, createElement(ProductMobilePrice, { oldPrice: 300 }), createElement(ProductPurchaseForm, { product: value, ...(editing ? { cartItemId: "cart-row", initial: { material: "petg", color: "black", quantity: 2 } } : {}) }))));
}
const compact = (text: string | null) => text?.replace(/\s/g, "");
it("keeps the price under the photo and the purchase total in sync with variant choices", async () => {
  await render();
  expect(compact(container.querySelector(".product-mobile-price strong")!.textContent)).toBe("200₽");
  expect(container.querySelector(".product-mobile-price s")).not.toBeNull();
  await act(async () => container.querySelector<HTMLInputElement>('input[value="petg"]')!.click());
  await act(async () => container.querySelector<HTMLInputElement>('input[value="black"]')!.click());
  expect(compact(container.querySelector(".product-mobile-price strong")!.textContent)).toBe("350₽");
  expect(compact(container.querySelector(".mobile-purchase-bar strong")!.textContent)).toBe("Итого:350₽");
  expect(container.querySelector(".product-mobile-price s")).toBeNull();
  const input = container.querySelector<HTMLInputElement>('input[name="quantity"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(compact(container.querySelector(".product-mobile-price strong")!.textContent)).toBe("350₽");
  expect(compact(container.querySelector(".mobile-purchase-bar strong")!.textContent)).toBe("Итого:700₽");
});
it("retains out-of-stock and made-to-order behavior in the persistent purchase bar", async () => {
  await render({ ...product, id: "unavailable", stock: 0 });
  expect(container.querySelector(".mobile-purchase-bar")!.textContent).toContain("Нет в наличии");
  expect(container.querySelector(".mobile-purchase-bar button")).toBeNull();
  await render({ ...product, id: "on-order", stock: 0, madeToOrder: true });
  expect(container.querySelector(".mobile-purchase-bar button")!.textContent).toBe("Добавить в корзину");
  expect(container.querySelector(".product-mobile-price")!.textContent).toContain("Под заказ");
});
it("keeps a cart editor's existing selection independent from the product page provider", async () => {
  await render(product, true);
  expect(container.querySelector<HTMLInputElement>('input[name="quantity"]')!.value).toBe("2");
  expect(compact(container.querySelector(".product-price strong")!.textContent)).toBe("700₽");
  expect(container.querySelector(".mobile-purchase-bar")).toBeNull();
});
it("does not offer a legacy-blocked product even when stock or made-to-order is available", async () => {
  const value = { ...product, madeToOrder: true };
  await act(async () => root.render(createElement(ProductPurchaseState, { product: value }, createElement(ProductMobilePrice, { stockReviewRequired: true }), createElement(ProductPurchaseForm, { product: value, stockReviewRequired: true }))));
  expect(container.querySelector(".product-mobile-price")!.textContent).toContain("Наличие уточняется");
  expect(container.querySelector(".mobile-purchase-bar button")).toBeNull();
  expect(container.querySelector(".purchase-form .notice")).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
});

