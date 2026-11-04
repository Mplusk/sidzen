// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ push: vi.fn(), pathname: "/catalog/", search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push }), usePathname: () => m.pathname, useSearchParams: () => new URLSearchParams(m.search) }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }) }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => createElement("a", props) }));
import { CatalogSearchInput } from "./catalog-search-input";
let root: Root, container: HTMLDivElement;
const item = { id: "p", name: "Чаша коралл", href: "/catalog/decor/coral/", price: 649, image: "/generated/product-organizer.webp" };
async function type(value: string) { await act(async () => { const input = container.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(async () => {
  m.pathname = "/catalog/"; m.search = "";
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ products: [item] })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(CatalogSearchInput)));
});
it("restores URL queries on navigation, reload-like remount, Back/Forward and clearing without overwriting typing", async () => {
  const navigate = async (search: string, pathname = "/catalog/") => {
    m.search = search; m.pathname = pathname;
    await act(async () => root.render(createElement(CatalogSearchInput)));
  };
  const input = () => container.querySelector("input")!;
  await navigate("q=%D1%87%D0%B0%D1%88%D0%B0"); expect(input().value).toBe("чаша");
  expect(input().getAttribute("aria-expanded")).toBe("false");
  await type("чаша розовая");
  await act(async () => root.render(createElement(CatalogSearchInput)));
  expect(input().value).toBe("чаша розовая");
  await navigate("q=лампа"); expect(input().value).toBe("лампа");
  await navigate("q=чаша"); expect(input().value).toBe("чаша"); // Back
  await navigate("q=лампа"); expect(input().value).toBe("лампа"); // Forward
  await navigate("q=лампа&sort=price-asc"); expect(input().value).toBe("лампа");
  await navigate(""); expect(input().value).toBe("");
  await navigate("q=лампа", "/"); expect(input().value).toBe("лампа");
  await navigate("q=unrelated", "/account/"); expect(input().value).toBe("");
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });
it("debounces queries, shows photo/price, selects with arrows and opens with Enter submission", async () => {
  await type("чаша"); expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(container.querySelector('[role="option"]')?.textContent).toContain("649"); expect(container.querySelector('[role="option"] img')).not.toBeNull();
  await act(async () => { container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(container.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
  await act(async () => container.querySelector("form")!.requestSubmit()); expect(m.push).toHaveBeenCalledWith(item.href);
});
it("ignores outdated responses and keeps empty/error recovery and ordinary search available", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await type("старая"); await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ products: [] }));
  await type("новая"); await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await act(async () => finish(Response.json({ products: [item] })));
  expect(container.querySelector('[role="option"]')).toBeNull(); expect(container.textContent).toContain("Ничего не нашли");
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await type("ошибка"); await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(container.textContent).toContain("Поиск по Enter работает"); expect(container.querySelector("form")!.getAttribute("action")).toBe("/");
  await act(async () => container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="combobox"]')!.getAttribute("aria-expanded")).toBe("false");
});
