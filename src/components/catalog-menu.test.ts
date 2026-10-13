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
const scrollTo = vi.fn(), disconnect = vi.fn(), observe = vi.fn();
let resize: (() => void) | undefined;
const props = {
  categories: [{ slug: "decor", name: "Декор" }],
  logo: createElement("a", { href: "/catalog/" }, "SIDZEN"),
  search: createElement("form", { onSubmit: submit }, createElement("input", { name: "q", defaultValue: "светильник" })),
  actions: createElement("a", { href: "/cart/" }, "Корзина"),
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe = observe; disconnect = disconnect; });
  vi.spyOn(window, "scrollTo").mockImplementation(scrollTo);
  scrollTo.mockClear(); disconnect.mockClear(); observe.mockClear(); resize = undefined;
  route.pathname = "/catalog/"; submit.mockClear(); filterClick.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(createElement(Fragment, null, createElement("header", { className: "site-header" }, createElement(CatalogMenu, props)), createElement("button", { id: "filters", type: "button", onClick: filterClick }, "Фильтры"))));
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
it("measures the whole sticky header when opening, closing and resizing", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: this.querySelector('.header-catalog-panel:not([hidden])') ? 182 : 109 } as DOMRect;
  });
  await render();
  expect(document.documentElement.style.getPropertyValue("--header-offset")).toBe("125px");
  expect(observe).toHaveBeenCalledWith(container.querySelector(".site-header"));
  await toggle(); expect(document.documentElement.style.getPropertyValue("--header-offset")).toBe("198px");
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ height: 260 } as DOMRect);
  resize!(); expect(document.documentElement.style.getPropertyValue("--header-offset")).toBe("276px");
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ height: 109 } as DOMRect);
  await toggle(); expect(document.documentElement.style.getPropertyValue("--header-offset")).toBe("125px");
  await act(async () => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(document.documentElement.style.getPropertyValue("--header-offset")).toBe("");
});
it("preserves the current scroll position so categories push content rather than covering it", async () => {
  vi.spyOn(window, "scrollY", "get").mockReturnValue(90);
  await render(); expect(scrollTo).not.toHaveBeenCalled();
  await toggle(); expect(scrollTo).toHaveBeenLastCalledWith({ top: 90, behavior: "instant" });
  route.pathname = "/catalog/decor/product/"; await render();
  expect(panel().hidden).toBe(false);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  await toggle(); expect(scrollTo).toHaveBeenLastCalledWith({ top: 90, behavior: "instant" });
});
it("captures scrolling before pointer focus can move a sticky button", async () => {
  const scroll = vi.spyOn(window, "scrollY", "get").mockReturnValue(80);
  await render();
  await act(async () => trigger().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  scroll.mockReturnValue(0);
  await toggle(); expect(scrollTo).toHaveBeenLastCalledWith({ top: 80, behavior: "instant" });
});
