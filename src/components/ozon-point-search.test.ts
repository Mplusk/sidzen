// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { OzonPointSearch } from "./ozon-point-search";

const points = [{ id: "42", name: "Ozon", address: "Омск, улица Бульварная, 20", type: "pvz", latitude: 55, longitude: 73 }];
let root: Root, container: HTMLDivElement;
const reset = vi.fn(), results = vi.fn(), openMap = vi.fn();
const input = () => container.querySelector<HTMLInputElement>("input")!;
const button = () => container.querySelector<HTMLButtonElement>("button")!;
async function type(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
async function search() { await act(async () => button().click()); }

describe("city search for the pickup map", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ points, truncated: false })));
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(createElement(OzonPointSearch, { onReset: reset, onResults: results, onOpenMap: openMap })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("only searches after a city is entered and opens the map", async () => {
    expect(container.querySelector("label")?.textContent).toBe("Город");
    expect(button().disabled).toBe(true);
    await type("Омск");
    expect(fetch).not.toHaveBeenCalled();
    await search();
    expect(fetch).toHaveBeenCalledWith("/api/delivery/ozon/points/?q=%D0%9E%D0%BC%D1%81%D0%BA", expect.objectContaining({ cache: "no-store" }));
    expect(results).toHaveBeenCalledWith(points, false); expect(openMap).toHaveBeenCalledOnce();
  });
  it("suggests cities while typing and selects one without choosing a pickup point", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ cities: ["Яблоновский", "Яблоновка"] }));
    await type("яблон");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(openMap).not.toHaveBeenCalled(); expect(results).not.toHaveBeenCalled();
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(input().value).toBe("Яблоновский");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(openMap).not.toHaveBeenCalled();
    await search();
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain(encodeURIComponent("Яблоновский"));
    expect(openMap).toHaveBeenCalledOnce();
  });
  it("does not display late suggestions after the user changes the city", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("яблон");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await type("Омск"); expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ cities: ["Яблоновский"] })));
    expect(container.textContent).not.toContain("Яблоновский");
  });
  it("ignores a stale response after editing the city", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск"); await search();
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    await type("Казань"); expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ points })));
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    await search(); expect(openMap).toHaveBeenCalledOnce();
  });
  it("supports Enter without submitting the form and gives errors for empty results or failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: [] }));
    await type("Омск");
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(container.textContent).toContain("Пункты выдачи не найдены");
    expect(openMap).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    await search(); expect(container.textContent).toContain("Не удалось загрузить пункты");
    await search(); expect(openMap).toHaveBeenCalledOnce();
  });
  it("loads every city page before opening the map and deduplicates overlapping IDs", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ ...points[0], id: String(index) }));
    const missingPoint = { ...points[0], id: "201", address: "Санкт-Петербург, улица Савушкина, 124 корпус 1" };
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: firstPage, truncated: true, nextOffset: 200 }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Санкт-Петербург"); await search();
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Загружено пунктов: 200");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("&offset=200");
    await act(async () => finish(Response.json({ points: [firstPage[199], missingPoint], truncated: false, nextOffset: null })));
    expect(results).toHaveBeenCalledWith([...firstPage, missingPoint], false);
    expect(openMap).toHaveBeenCalledOnce();
  });
  it("never displays an incomplete map when a later page fails, and retries from the first page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset: 200 }))
      .mockRejectedValueOnce(new Error("network"));
    await type("Омск"); await search();
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Не удалось загрузить пункты");
    await search();
    expect(vi.mocked(fetch).mock.calls[2][0]).not.toContain("offset=");
    expect(openMap).toHaveBeenCalledOnce();
  });
  it("aborts a later page on a city change and ignores its stale result", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset: 200 }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск"); await search();
    const signal = vi.mocked(fetch).mock.calls[1][1]!.signal!;
    await type("Казань"); expect(signal.aborted).toBe(true);
    await act(async () => finish(Response.json({ points, truncated: false })));
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    await search(); expect(openMap).toHaveBeenCalledOnce();
  });
  it("also cancels loading when another city is chosen from saved suggestions", async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ cities: ["Омск", "Омское"] }))
      .mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset: 200 }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type("Омск");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => container.querySelector<HTMLButtonElement>('.ozon-point-search > button')!.click());
    await act(async () => input().focus());
    const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent === "Омское")!;
    await act(async () => option.click());
    expect(input().value).toBe("Омское");
    expect(vi.mocked(fetch).mock.calls[2][1]!.signal!.aborted).toBe(true);
    await act(async () => finish(Response.json({ points, truncated: false })));
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });
  it("refuses to combine pages belonging to different delivery configurations", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset: 200, scope: "first" }))
      .mockResolvedValueOnce(Response.json({ points, truncated: false, scope: "second" }));
    await type("Омск"); await search();
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Не удалось загрузить пункты");
  });
  it.each([undefined, 0, -200, 1.5, 1000001])("rejects a broken continuation instead of silently truncating: %s", async nextOffset => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset }));
    await type("Омск"); await search();
    expect(fetch).toHaveBeenCalledOnce();
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Не удалось загрузить пункты");
  });
  it("continues after a page with no active results and refuses a repeated cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: [], truncated: true, nextOffset: 200 }))
      .mockResolvedValueOnce(Response.json({ points, truncated: true, nextOffset: 200 }));
    await type("Омск"); await search();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results).not.toHaveBeenCalled(); expect(openMap).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Не удалось загрузить пункты");
  });
});
