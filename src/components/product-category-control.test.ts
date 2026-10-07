// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductCategoryControl } from "./product-category-control";
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("offers automatic creation without a category, then protects a manual override", async () => {
  await act(async () => root.render(createElement(ProductCategoryControl, { categories: [{ id: "c1", name: "Лампы" }], initialCategoryId: "", initialMode: "AI", aiReady: true })));
  const category = container.querySelector<HTMLSelectElement>('select[name="primaryCategoryId"]')!, mode = container.querySelector<HTMLSelectElement>('select[name="categoryMode"]')!;
  expect(category.required).toBe(false); expect(mode.value).toBe("AI");
  await act(async () => { category.value = "c1"; category.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(mode.value).toBe("MANUAL"); expect(category.required).toBe(true); expect(category.value).toBe("c1");
  await act(async () => { mode.value = "AI"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(mode.value).toBe("AI"); expect(category.required).toBe(false);
});
it("disables new AI selection until configured and preserves the manual category", async () => {
  await act(async () => root.render(createElement(ProductCategoryControl, { categories: [{ id: "c1", name: "Лампы" }], initialCategoryId: "c1", initialMode: "MANUAL", aiReady: false })));
  expect(container.querySelector<HTMLOptionElement>('option[value="AI"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLSelectElement>('select[name="primaryCategoryId"]')!.value).toBe("c1");
  expect(container.textContent).toContain("Подключить DeepSeek");
});
