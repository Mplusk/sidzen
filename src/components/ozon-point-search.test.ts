// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { OzonPointSearch } from "./ozon-point-search";

const city = { name: "Омск", bounds: { south: 54.8, west: 72.9, north: 55.2, east: 73.6 } };
const directory = ["Москва", "Омск", "Тамбов", "Яблоновский", "Яблоновка"];
let root: Root, container: HTMLDivElement;
const reset = vi.fn(), onCity = vi.fn();
const input = () => container.querySelector<HTMLInputElement>("input")!;
const button = () => container.querySelector<HTMLButtonElement>(".ozon-point-search > button")!;
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
async function search() { await act(async () => button().click()); }

describe("city search for the pickup map", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.includes("view=directory") ? { cities: directory } : { city, scope: "fixture" }))));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onCity })));
    vi.mocked(fetch).mockClear();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("opens immediately with city bounds after one metadata request, without fetching the directory", async () => {
    expect(button().disabled).toBe(true);
    await type("Омск"); expect(fetch).not.toHaveBeenCalled();
    await search();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("view=city");
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(encodeURIComponent("Омск"));
    expect(onCity).toHaveBeenCalledWith(city);
    expect(container.textContent).not.toContain("Загружено пунктов");
  });
  it("shows suggestions immediately on each keystroke from two letters without extra requests", async () => {
    await type("м"); expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    await type("мо"); expect(container.querySelector('[role="option"]')?.textContent).toBe("Москва");
    await type("мос"); expect(container.querySelector('[role="option"]')?.textContent).toBe("Москва");
    await type("яблон");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(input().value).toBe("Яблоновский"); expect(onCity).not.toHaveBeenCalled();
    await search(); expect(onCity).toHaveBeenCalledOnce();
  });
  it("offers spelling corrections from the preloaded directory", async () => {
    await type("Табмов");
    expect(container.querySelector('[role="option"]')?.textContent).toBe("Тамбов");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts stale city results after editing", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск"); await search();
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await type("Казань"); expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ city, scope: "fixture" })));
    expect(onCity).not.toHaveBeenCalled();
  });
  it("clears the city and aborts a pending search without reopening the map", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск"); await search();
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Очистить город"]')!.click());
    expect(input().value).toBe(""); expect(document.activeElement).toBe(input());
    expect(signal.aborted).toBe(true); expect(button().disabled).toBe(true);
    await act(async () => finish(Response.json({ city, scope: "fixture" })));
    expect(onCity).not.toHaveBeenCalled();
  });
  it("does not display late suggestions after the user changes the city", async () => {
    vi.useFakeTimers();
    await act(async () => root.unmount()); root = createRoot(container);
    let finishDirectory!: (value: Response) => void, finish!: (value: Response) => void;
    vi.mocked(fetch).mockClear().mockImplementationOnce(() => new Promise(resolve => { finishDirectory = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onCity })));
    await type("яблон"); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
    await type("Омск"); expect(signal.aborted).toBe(true);
    await act(async () => finishDirectory(Response.json({ cities: directory })));
    expect(container.querySelector('[role="option"]')?.textContent).toBe("Омск");
    await act(async () => finish(Response.json({ cities: ["Яблоновский"] })));
    expect(container.textContent).not.toContain("Яблоновский");
  });
  it("keeps manual search available when suggestions fail", async () => {
    vi.useFakeTimers();
    await act(async () => root.unmount()); root = createRoot(container);
    vi.mocked(fetch).mockImplementation(url => String(url).includes("view=directory") || String(url).includes("view=cities") ? Promise.reject(new Error("network")) : Promise.resolve(Response.json({ city, scope: "fixture" })));
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onCity })));
    await type("Омск"); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(container.textContent).toContain("Подсказки временно недоступны");
    expect(button().disabled).toBe(false);
    await search(); expect(onCity).toHaveBeenCalledOnce();
  });
  it("does not reopen suggestions when the directory arrives after a city is chosen", async () => {
    vi.useFakeTimers();
    await act(async () => root.unmount()); root = createRoot(container);
    let finishDirectory!: (value: Response) => void;
    vi.mocked(fetch).mockClear().mockImplementationOnce(() => new Promise(resolve => { finishDirectory = resolve; }))
      .mockResolvedValueOnce(Response.json({ cities: ["Омск"] }));
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onCity })));
    await type("Ом"); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    await act(async () => finishDirectory(Response.json({ cities: directory })));
    expect(input().value).toBe("Омск"); expect(container.querySelector('[role="option"]')).toBeNull();
  });
  it("offers a spelling correction without silently changing the city", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ city: null, scope: "fixture" })).mockResolvedValueOnce(Response.json({ cities: ["Тамбов"] }));
    await type("Табмов"); await search();
    expect(input().value).toBe("Табмов"); expect(onCity).not.toHaveBeenCalled();
    expect(container.querySelector('[role="option"]')?.textContent).toBe("Тамбов");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(input().value).toBe("Тамбов"); expect(onCity).not.toHaveBeenCalled();
  });
  it("allows retry after a failed metadata request", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    await type("Омск"); await search(); expect(onCity).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await search(); expect(onCity).toHaveBeenCalledOnce();
  });
});
