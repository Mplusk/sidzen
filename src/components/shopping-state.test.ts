// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/actions/favorites", () => ({ setFavorite: m.save }));
vi.mock("next/navigation", () => ({ usePathname: () => "/catalog/" }));
import { ShoppingState } from "./shopping-state";
import { HeaderShoppingActions } from "./header-shopping-actions";
import { FavoriteButton } from "./favorite-button";
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.save.mockReset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(ids: string[], quantity = 0) {
  await act(async () => root.render(createElement(ShoppingState, { ids, cartQuantity: quantity }, createElement(HeaderShoppingActions), createElement(FavoriteButton, { productId: "first", name: "Чаша" }))));
}
it("shows quantity badges only for nonzero values and reads the same saved state on every surface", async () => {
  await render(["first"], 12);
  expect(container.querySelector('[aria-label="Избранное: 1"] .header-count')!.textContent).toBe("1");
  expect(container.querySelector('[aria-label="Корзина: 12"] .header-count')!.textContent).toBe("12");
  expect(container.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
  await render([], 0);
  expect(container.querySelectorAll(".header-count")).toHaveLength(0);
  expect(container.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
});
it("updates the heart and counter immediately, then rolls back a failed save accessibly", async () => {
  let complete: (value: { error?: string }) => void = () => {};
  m.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await render([]);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="Избранное: 1"]')).not.toBeNull();
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(m.save).toHaveBeenCalledExactlyOnceWith("first", true);
  await act(async () => complete({ error: "Не удалось сохранить выбор." }));
  expect(container.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector('[aria-label="Избранное: 0"]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Не удалось сохранить выбор.");
});
