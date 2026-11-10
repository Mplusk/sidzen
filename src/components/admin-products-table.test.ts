// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/app/actions/product-bulk", () => ({ bulkProductStatusAction: vi.fn() }));
vi.mock("@/app/actions/product-price", () => ({ updateProductPriceAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AdminProductsTable, type AdminProductRow } from "./admin-products-table";
let root: Root, container: HTMLDivElement;
const products: AdminProductRow[] = [0, 1, 2].map(index => ({ id: String(index), name: "Bowl", sku: `sku-${index}`, category: "—", price: "599 ₽", oldPrice: null, rawBasePrice: "599", rawOldPrice: null, productVersion: "2026-11-10T00:00:00.000Z", hasVariants: false, switchesToSite: false, stock: 0, reservedStock: 0, madeToOrder: false, stockReviewRequired: false, status: index === 2 ? "PUBLISHED" : "DRAFT", canEdit: index !== 2 }));
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("selects only editable rows, supports partial/select-all/clear and submits selected IDs", async () => {
  await act(async () => root.render(createElement(AdminProductsTable, { products, categories: [], canWrite: true, canPublish: false })));
  const all = container.querySelector<HTMLInputElement>('input[aria-label="Выбрать все товары в списке"]')!;
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[name="productIds"]')];
  const apply = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Применить к выбранным")!;
  expect(container.querySelectorAll('button[aria-label^="Изменить цену товара"]')).toHaveLength(2);
  expect(apply.disabled).toBe(true); expect(boxes[2].disabled).toBe(true); expect(container.querySelector("select")!.value).toBe("DRAFT");
  await act(async () => boxes[0].click()); expect(all.indeterminate).toBe(true); expect(apply.disabled).toBe(false);
  expect(new FormData(container.querySelector("form")!).getAll("productIds")).toEqual(["0"]);
  await act(async () => all.click()); expect(all.checked).toBe(true); expect(boxes[2].checked).toBe(false);
  expect(new FormData(container.querySelector("form")!).getAll("productIds")).toEqual(["0", "1"]);
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Снять выбор")!.click());
  expect(apply.disabled).toBe(true); expect(all.indeterminate).toBe(false);
});
it("provides a fallback category only for publication and hides selection for read-only staff", async () => {
  await act(async () => root.render(createElement(AdminProductsTable, { products, categories: [{ id: "cat", name: "Декор" }], canWrite: true, canPublish: true })));
  expect(container.querySelector<HTMLSelectElement>('select[name="status"]')!.value).toBe("PUBLISHED");
  expect(container.querySelector('select[name="categoryId"]')!.textContent).toContain("Декор");
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('select[name="status"]')!; select.value = "HIDDEN"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.querySelector('select[name="categoryId"]')).toBeNull();
  await act(async () => root.render(createElement(AdminProductsTable, { products, categories: [], canWrite: false, canPublish: false })));
  expect(container.querySelector('input[type="checkbox"]')).toBeNull(); expect(container.querySelector('select[name="status"]')).toBeNull();
  expect(container.querySelectorAll('button[aria-label^="Изменить цену товара"]')).toHaveLength(0);
});
it("opens a separate price form and explains marketplace and variant effects", async () => {
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  try {
    const linked = [{ ...products[0], switchesToSite: true, hasVariants: true }];
    await act(async () => root.render(createElement(AdminProductsTable, { products: linked, categories: [], canWrite: true, canPublish: true })));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Изменить цену товара"]')!.click());
    const dialog = container.querySelector<HTMLDialogElement>("dialog")!;
    expect(showModal).toHaveBeenCalledOnce();
    expect(container.querySelector("form.admin-products-bulk")!.contains(dialog)).toBe(false);
    expect(dialog.querySelector<HTMLInputElement>('input[name="basePrice"]')!.value).toBe("599");
    expect(dialog.querySelector<HTMLInputElement>('input[name="acceptSiteMode"]')!.required).toBe(true);
    expect(dialog.textContent).toContain("название, описание, фотографии и цену");
    expect(dialog.textContent).toContain("цена для покупателя может остаться прежней");
  } finally { delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal; }
});
it("distinguishes saleable stock, reservations and products awaiting legacy review", async () => {
  const values = [
    { ...products[0], stock: 8, reservedStock: 3 },
    { ...products[1], stock: 999, stockReviewRequired: true },
    { ...products[2], stock: 0, madeToOrder: true },
  ];
  await act(async () => root.render(createElement(AdminProductsTable, { products: values, categories: [], canWrite: true, canPublish: true, canReadOrders: true })));
  const rows = container.querySelectorAll("tbody tr");
  expect(rows[0].textContent).toContain("5 доступно");
  expect(rows[0].textContent).toContain("На складе: 8 · в резерве: 3");
  expect(rows[1].textContent).toContain("999 в системе");
  expect(rows[1].textContent).toContain("Продажа приостановлена: требуется сверка");
  const href = [...rows[1].querySelectorAll("a")].find(link => link.textContent === "Сверить заказы")?.getAttribute("href");
  const url = new URL(href!, "https://sidzen.shop");
  expect(url.pathname.replace(/\/$/, "")).toBe("/admin/orders");
  expect(url.searchParams.get("view")).toBe("stock-review"); expect(url.searchParams.get("q")).toBe("sku-1");
  expect(rows[2].textContent).toContain("Можно заказать изготовление");
  await act(async () => root.render(createElement(AdminProductsTable, { products: values, categories: [], canWrite: false, canPublish: false, canReadOrders: false })));
  expect(container.querySelector('a[href*="view=stock-review"]')).toBeNull();
});
