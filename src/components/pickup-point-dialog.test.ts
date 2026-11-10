// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const map = vi.hoisted(() => ({ render: vi.fn(), measure: vi.fn() }));
vi.mock("next/dynamic", async () => {
  const { useEffect, useRef, createElement } = await import("react");
  return { default: () => (props: unknown) => {
    const element = useRef<HTMLDivElement>(null);
    map.render(props);
    useEffect(() => { map.measure(element.current?.closest("dialog")?.open); }, []);
    return createElement("div", { ref: element });
  } };
});
import { PickupPointDialog } from "./pickup-point-dialog";

const points = [
  { id: "one", name: "Пункт на Морской", address: "Санкт-Петербург, Большая Морская улица, 34", type: "pvz", latitude: 59.93, longitude: 30.30 },
  { id: "two", name: "Пункт на Невском", address: "Санкт-Петербург, Невский проспект, 11", type: "pvz", latitude: 59.94, longitude: 30.31, workTime: "Пн–Вс 09:00–21:00" },
];
const onSelect = vi.fn(), onClose = vi.fn();
let root: Root, container: HTMLDivElement;
const pointButtons = () => [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
const confirm = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Выбрать этот пункт")!;
const showMore = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Показать ещё");
const manyPoints = () => Array.from({ length: 235 }, (_, index) => ({ ...points[0], id: `point-${index}`, address: `Санкт-Петербург, улица Тестовая, ${index + 1}` }));
async function render(carrier: "Ozon" | "СДЭК" = "Ozon", selected = "") {
  await act(async () => root.render(createElement(PickupPointDialog, { points, selected, carrier, onSelect, onClose })));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("pickup point dialog", () => {
  it("opens the dialog before the map measures its container, including on reopen", async () => {
    await render();
    expect(map.measure).toHaveBeenLastCalledWith(true);
    await act(async () => root.render(null));
    await render();
    expect(map.measure).toHaveBeenCalledTimes(2);
    expect(map.measure).toHaveBeenLastCalledWith(true);
  });

  it("previews a list selection and confirms only through the explicit action", async () => {
    await render();
    expect(confirm()).toBeUndefined();
    await act(async () => pointButtons()[0].click());
    expect(pointButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(confirm().disabled).toBe(false);
    expect(confirm().closest('section[aria-label="Выбранный пункт"]')).not.toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    expect(container.textContent).not.toContain("Найдите удобный адрес на карте или в списке");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => pointButtons()[1].click());
    expect(pointButtons()[0].getAttribute("aria-pressed")).toBe("false");
    expect(pointButtons()[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("two", points[1]);
  });

  it("cancels a preview without changing the previously confirmed point", async () => {
    await render("Ozon", "one");
    await act(async () => pointButtons()[1].click());
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => { container.querySelector("dialog")!.dispatchEvent(cancel); });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes through the labelled control and restores focus to the opener", async () => {
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    try {
      await render();
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Закрыть выбор пункта"]')!.click());
      expect(onClose).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
      await act(async () => root.render(null));
      expect(document.activeElement).toBe(opener);
    } finally { opener.remove(); }
  });

  it.each([ ["Ozon", "/brand/ozon-delivery.svg"], ["СДЭК", "/brand/cdek.svg"] ] as const)("shows the correct %s logo and available hours", async (carrier, logo) => {
    await render(carrier, "two");
    const sources = [...container.querySelectorAll("img")].map(image => decodeURIComponent(image.getAttribute("src") || ""));
    expect(sources.some(source => source.includes(logo))).toBe(true);
    expect(container.textContent).toContain(points[1].workTime);
    expect(pointButtons()[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("allows selection when no operating hours were supplied", async () => {
    await act(async () => root.render(createElement(PickupPointDialog, { points: [points[0]], selected: "one", carrier: "Ozon", onSelect, onClose })));
    expect(container.textContent).toContain(points[0].address);
    expect(container.textContent).not.toMatch(/undefined|null|09:00|21:00|Срок хранения|Макс\. вес/);
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("one", points[0]);
  });

  it("keeps every map point while revealing the entire list in batches of 100", async () => {
    const directory = manyPoints();
    await act(async () => root.render(createElement(PickupPointDialog, { points: directory, selected: "", carrier: "Ozon", onSelect, onClose })));
    expect(map.render.mock.lastCall?.[0].points).toBe(directory);
    expect(container.querySelector("aside h3")?.textContent).toBe("Пункты выдачи");
    expect(container.querySelector("aside h3")?.nextElementSibling).toBeNull();
    expect(pointButtons()).toHaveLength(100);
    const listId = showMore()!.getAttribute("aria-controls");
    expect(document.getElementById(listId!)?.contains(pointButtons()[0])).toBe(true);
    await act(async () => showMore()!.click());
    expect(pointButtons()).toHaveLength(200);
    await act(async () => showMore()!.click());
    expect(pointButtons()).toHaveLength(235);
    expect(showMore()).toBeUndefined();
    expect(pointButtons()[234].textContent).toContain(directory[234].address);
    await act(async () => pointButtons()[234].click());
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("point-234", directory[234]);
  });

  it("previews and confirms points outside the visible list when selected on the map", async () => {
    const directory = manyPoints();
    await act(async () => root.render(createElement(PickupPointDialog, { points: directory, selected: "point-220", carrier: "Ozon", onSelect, onClose })));
    const summary = () => container.querySelector('section[aria-label="Выбранный пункт"]')!;
    expect(summary().textContent).toContain(directory[220].address);
    expect(pointButtons()).toHaveLength(100);
    const mapSelect = map.render.mock.lastCall?.[0].onSelect as (id: string) => void;
    await act(async () => mapSelect("point-234"));
    expect(summary().textContent).toContain(directory[234].address);
    expect(pointButtons().every(button => button.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("point-234", directory[234]);
  });

  it("resets the list window for another result set and when reopened", async () => {
    const directory = manyPoints();
    const renderDirectory = async (currentPoints = directory) => {
      await act(async () => root.render(createElement(PickupPointDialog, { points: currentPoints, selected: "", carrier: "Ozon", onSelect, onClose })));
    };
    await renderDirectory();
    await act(async () => showMore()!.click());
    expect(pointButtons()).toHaveLength(200);
    await renderDirectory([...directory]);
    expect(pointButtons()).toHaveLength(100);
    await act(async () => showMore()!.click());
    expect(pointButtons()).toHaveLength(200);
    await act(async () => root.render(null));
    await renderDirectory();
    expect(pointButtons()).toHaveLength(100);
  });

  it("opens immediately for a city before any viewport points have loaded", async () => {
    const city = { name: "Омск", bounds: { south: 54.8, west: 72.9, north: 55.2, east: 73.6 } };
    await act(async () => root.render(createElement(PickupPointDialog, { city, selected: "", carrier: "Ozon", onSelect, onClose })));
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(map.measure).toHaveBeenLastCalledWith(true);
    expect(confirm()).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps a selected point available when it leaves the visible viewport", async () => {
    const city = { name: "Санкт-Петербург", bounds: { south: 59.9, west: 30.2, north: 60, east: 30.4 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ points: [points[1]], clusters: [], scope: "fixture" })));
    await act(async () => root.render(createElement(PickupPointDialog, { city, selected: "one", selectedPoint: points[0], carrier: "Ozon", onSelect, onClose })));
    const onViewportChange = map.render.mock.lastCall?.[0].onViewportChange as (value: unknown) => void;
    await act(async () => { onViewportChange({ bounds: { south: 59.90, west: 30.305, north: 59.97, east: 30.35 }, zoom: 14 }); await new Promise(resolve => setTimeout(resolve, 260)); });
    expect(fetch).toHaveBeenCalledOnce();
    expect(container.querySelector('section[aria-label="Выбранный пункт"]')?.textContent).toContain(points[0].address);
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("one", points[0]);
  });

  it("shows real overview addresses without turning all preview entries into markers", async () => {
    vi.useFakeTimers();
    const bounds = { south: 59.9, west: 30.2, north: 60, east: 30.4 };
    const city = { name: "Санкт-Петербург", bounds };
    const clusters = [{ id: "overview", latitude: 59.94, longitude: 30.3, count: 500, bounds }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ points: [], listPoints: points, clusters, scope: "overview" })));
    await act(async () => root.render(createElement(PickupPointDialog, { city, selected: "", carrier: "Ozon", onSelect, onClose })));
    await act(async () => { map.render.mock.lastCall?.[0].onViewportChange({ bounds, zoom: 11 }); await vi.advanceTimersByTimeAsync(221); });
    expect(pointButtons()).toHaveLength(2);
    expect(map.render.mock.lastCall?.[0].points).toEqual([]);
    expect(map.render.mock.lastCall?.[0].clusters).toEqual(clusters);
    expect(container.textContent).not.toContain("Приблизьте нужный район");
    await act(async () => pointButtons()[1].click());
    expect(map.render.mock.lastCall?.[0].points).toEqual([points[1]]);
    expect(map.render.mock.lastCall?.[0].selected).toBe("two");
    expect(map.render.mock.lastCall?.[0].focusRequest).toEqual({ id: "two", revision: 1 });
    expect(document.activeElement).toBe(confirm());
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("two", points[1]);
  });

  it("previews map-only points and keeps them through an overview response change", async () => {
    vi.useFakeTimers();
    const bounds = { south: 59.9, west: 30.2, north: 60, east: 30.4 };
    const city = { name: "Санкт-Петербург", bounds };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ points: [points[0]], listPoints: [points[1]], clusters: [], scope: "overview" }))
      .mockResolvedValueOnce(Response.json({ points: [], listPoints: [], clusters: [], scope: "overview" })));
    await act(async () => root.render(createElement(PickupPointDialog, { city, selected: "", carrier: "Ozon", onSelect, onClose })));
    await act(async () => { map.render.mock.lastCall?.[0].onViewportChange({ bounds, zoom: 11 }); await vi.advanceTimersByTimeAsync(221); });
    expect(pointButtons()).toHaveLength(1);
    expect(pointButtons()[0].textContent).toContain(points[1].address);
    expect(map.render.mock.lastCall?.[0].points).toEqual([points[0]]);
    await act(async () => map.render.mock.lastCall?.[0].onSelect("one"));
    expect(container.querySelector('section[aria-label="Выбранный пункт"]')?.textContent).toContain(points[0].address);
    expect(map.render.mock.lastCall?.[0].focusRequest).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => { map.render.mock.lastCall?.[0].onViewportChange({ bounds: { ...bounds, west: 30.5, east: 30.7 }, zoom: 14 }); await vi.advanceTimersByTimeAsync(221); });
    expect(pointButtons()).toHaveLength(0);
    expect(map.render.mock.lastCall?.[0].points).toEqual([points[0]]);
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("one", points[0]);
  });

  it("can focus the same list address again after the map has been moved", async () => {
    await render();
    await act(async () => pointButtons()[0].click());
    expect(map.render.mock.lastCall?.[0].focusRequest).toEqual({ id: "one", revision: 1 });
    await act(async () => pointButtons()[0].click());
    expect(map.render.mock.lastCall?.[0].focusRequest).toEqual({ id: "one", revision: 2 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
