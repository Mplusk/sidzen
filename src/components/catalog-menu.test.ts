// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/catalog/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => createElement("a", { ...props, onClick: (event: MouseEvent) => event.preventDefault() }) }));
import { CatalogMenu } from "./catalog-menu";

let root: Root, container: HTMLDivElement;
const submit = vi.fn(), filterClick = vi.fn();
const props = {
  categories: [{ slug: "decor", name: "Декор" }],
  logo: createElement("a", { href: "/catalog/" }, "SIDZEN"),
  search: createElement("form", { onSubmit: submit }, createElement("input", { name: "q", defaultValue: "светильник" })),
  actions: createElement("a", { href: "/cart/" }, "Корзина"),
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  route.pathname = "/catalog/"; submit.mockClear(); filterClick.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(createElement(Fragment, null, createElement(CatalogMenu, props), createElement("button", { id: "filters", type: "button", onClick: filterClick }, "Фильтры"))));
}
const trigger = () => container.querySelector<HTMLButtonElement>(".header-catalog")!;
const panel = () => container.querySelector<HTMLElement>(".header-catalog-panel")!;
async function toggle() { await act(async () => trigger().click()); }

it("toggles only the category row without submitting search or remounting its input", async () => {
  await render(); const input = container.querySelector<HTMLInputElement>('input[name="q"]')!;
  expect(trigger().type).toBe("button"); expect(panel().hidden).toBe(true);
  expect(trigger().getAttribute("aria-controls")).toBe(panel().id);
  await toggle(); expect(panel().hidden).toBe(false); expect(trigger().getAttribute("aria-expanded")).toBe("true");
  await toggle(); expect(panel().hidden).toBe(true);
  expect(container.querySelector('input[name="q"]')).toBe(input); expect(input.value).toBe("светильник"); expect(submit).not.toHaveBeenCalled();
});
it("keeps categories after the search row in normal document order", async () => {
  await render(); await toggle();
  expect(panel().previousElementSibling?.className).toBe("header-main");
  expect([...panel().querySelectorAll("a")].map(link => link.textContent)).toEqual(["Все товары", "Декор"]);
});
it("does not collapse on pointerdown, blur or clicking Filters", async () => {
  await render(); await toggle();
  const filters = container.querySelector<HTMLButtonElement>("#filters")!;
  await act(async () => { trigger().focus(); filters.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); filters.focus(); });
  expect(panel().hidden).toBe(false);
  await act(async () => filters.click());
  expect(filterClick).toHaveBeenCalledTimes(1); expect(panel().hidden).toBe(false);
});
it("does not hide category navigation on Escape", async () => {
  await render(); await toggle();
  await act(async () => { panel().querySelector<HTMLAnchorElement>("a")!.focus(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(panel().hidden).toBe(false); expect(trigger().getAttribute("aria-expanded")).toBe("true");
});
it("stays open after category selection and route changes until Catalog is pressed again", async () => {
  await render(); await toggle();
  await act(async () => panel().querySelectorAll<HTMLAnchorElement>("a")[1].click());
  expect(panel().hidden).toBe(false);
  route.pathname = "/catalog/decor/"; await render();
  expect(panel().hidden).toBe(false);
  expect(panel().querySelector('a[href="/catalog/decor/"]')!.getAttribute("aria-current")).toBe("page");
  route.pathname = "/catalog/"; await render();
  expect(panel().hidden).toBe(false);
  expect(panel().querySelector('a[href="/catalog/"]')!.getAttribute("aria-current")).toBe("page");
  await toggle(); expect(panel().hidden).toBe(true);
  route.pathname = "/catalog/decor/"; await render(); expect(panel().hidden).toBe(true);
});
