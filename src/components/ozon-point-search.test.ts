// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { OzonPointSearch } from "./ozon-point-search";

const points = [{ id: "42", name: "Ozon", address: "Омск, улица Бульварная, 20", type: "pvz", latitude: 55, longitude: 73 }, { id: "43", name: "Ozon", address: "Омск, улица Бульварная, 24", type: "postamat", latitude: 55, longitude: 73 }];
let root: Root, container: HTMLDivElement;
const reset = vi.fn(), results = vi.fn(), select = vi.fn();
const input = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
async function key(value: string, composing = false) { await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, isComposing: composing }))); }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(300); }); }
describe("live pickup suggestions", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ points, truncated: false })));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onResults: results, onSelect: select })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });
  it("debounces typing and displays actual addresses without loading the map or sending a phone", async () => {
    await type("О"); await settle(); expect(fetch).not.toHaveBeenCalled();
    await type("Ом"); await type("Омск бу"); expect(container.textContent).toContain("Ищем подходящие адреса");
    await settle(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/delivery/ozon/points/?q=%D0%9E%D0%BC%D1%81%D0%BA%20%D0%B1%D1%83&view=suggest", expect.objectContaining({ cache: "no-store" }));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2); expect(results).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });
  it("supports Arrow keys, Enter selection and Escape without submitting a checkout", async () => {
    await type("Омск бу"); await settle(); await key("ArrowDown"); await key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(container.querySelectorAll('[role="option"]')[1].id);
    await key("Enter"); expect(select).toHaveBeenCalledWith("43"); expect(results).toHaveBeenCalledWith(points, false);
    expect(input().value).toBe("Омск бу"); expect(input().getAttribute("aria-expanded")).toBe("false");
    await type("Омск"); await settle(); await key("Escape"); expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
  it("selects by pointer and cancels a scheduled request", async () => {
    await type("Омск"); await settle();
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(select).toHaveBeenCalledWith("42"); expect(input().value).toBe("Омск");
    await type("Омск б"); await type(""); await settle(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
  it("offers all matching map points from inside the popover", async () => {
    await type("Омск"); await settle();
    await act(async () => container.querySelector<HTMLButtonElement>('.ozon-search-map-link')!.click());
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("/api/delivery/ozon/points/?q=%D0%9E%D0%BC%D1%81%D0%BA");
    expect(results).toHaveBeenCalledWith(points, false); expect(select).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });
  it("Enter with no highlighted suggestion searches all points; IME Enter does not search", async () => {
    await type("Омск"); await key("Enter", true); expect(fetch).not.toHaveBeenCalled();
    await key("Enter"); expect(results).toHaveBeenCalledWith(points, false); expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).not.toContain("view=suggest");
  });
  it("ignores stale responses and aborts them on editing or unmount", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск"); await settle(); const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await type("Казань"); expect(signal.aborted).toBe(true); await settle();
    await act(async () => finish(Response.json({ points: [{ ...points[0], address: "STALE" }] })));
    expect(container.textContent).not.toContain("STALE");
    await type("Казань улица"); await act(async () => root.render(null)); await settle(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("shows empty, network and rate limit feedback and allows retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: [] })); await type("Неизвестно"); await settle();
    expect(container.textContent).toContain("ПВЗ не найдены");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await type("Омск"); await settle(); expect(container.textContent).toContain("Не удалось загрузить адреса");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 429 })); await type("Омск б"); await settle(); expect(container.textContent).toContain("Слишком много запросов");
    await act(async () => container.querySelector<HTMLButtonElement>('.button')!.click()); expect(results).toHaveBeenCalledWith(points, false);
  });
  it("closes on blur, reopens on focus, and explains an actual request timeout", async () => {
    await type("Омск"); await settle();
    await act(async () => { input().focus(); input().blur(); });
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await act(async () => input().focus()); expect(input().getAttribute("aria-expanded")).toBe("true");
    vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("timeout")))));
    await type("Омск б"); await settle(); await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(container.textContent).toContain("Не удалось загрузить адреса"); expect(container.querySelector('.button')?.getAttribute("aria-busy")).toBe("false");
  });
});
