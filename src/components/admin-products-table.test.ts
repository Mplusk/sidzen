// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/app/actions/product-bulk", () => ({ bulkProductStatusAction: vi.fn() }));
import { AdminProductsTable, type AdminProductRow } from "./admin-products-table";
let root: Root, container: HTMLDivElement;
const products: AdminProductRow[] = [0, 1, 2].map(index => ({ id: String(index), name: "Bowl", sku: `sku-${index}`, category: "—", price: "599 ₽", stock: 0, status: index === 2 ? "PUBLISHED" : "DRAFT", canEdit: index !== 2 }));
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("selects only editable rows, supports partial/select-all/clear and submits selected IDs", async () => {
  await act(async () => root.render(createElement(AdminProductsTable, { products, categories: [], canWrite: true, canPublish: false })));
  const all = container.querySelector<HTMLInputElement>('input[aria-label="Выбрать все товары в списке"]')!;
  const boxes = [...container.querySelectorAll<HTMLInputElement>('input[name="productIds"]')];
  const apply = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Применить к выбранным")!;
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
});
