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
});
