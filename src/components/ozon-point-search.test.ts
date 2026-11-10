// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { OzonPointSearch } from "./ozon-point-search";

const city = { name: "Омск", bounds: { south: 54.8, west: 72.9, north: 55.2, east: 73.6 } };
let root: Root, container: HTMLDivElement;
const reset = vi.fn(), onCity = vi.fn();
const input = () => container.querySelector<HTMLInputElement>("input")!;
const button = () => container.querySelector<HTMLButtonElement>(".ozon-point-search > button")!;
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
async function search() { await act(async () => button().click()); }

describe("city search for the pickup map", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ city, scope: "fixture" })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onCity })));
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
  it("offers keyboard city suggestions without opening the map", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ cities: ["Яблоновский", "Яблоновка"] }));
    await type("яблон"); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(input().value).toBe("Яблоновский"); expect(onCity).not.toHaveBeenCalled();
    await search(); expect(onCity).toHaveBeenCalledOnce();
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
  it("does not display late suggestions after the user changes the city", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("яблон"); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await type("Омск"); expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ cities: ["Яблоновский"] })));
    expect(container.textContent).not.toContain("Яблоновский");
  });
  it("keeps manual search available when suggestions fail", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    await type("Омск"); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(container.textContent).toContain("Подсказки временно недоступны");
    expect(button().disabled).toBe(false);
    await search(); expect(onCity).toHaveBeenCalledOnce();
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
