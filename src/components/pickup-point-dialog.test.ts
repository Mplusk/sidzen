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
const confirm = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Выбрать пункт")!;
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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

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
    expect(confirm().disabled).toBe(true);
    await act(async () => pointButtons()[0].click());
    expect(pointButtons()[0].getAttribute("aria-pressed")).toBe("true");
    expect(confirm().disabled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => pointButtons()[1].click());
    expect(pointButtons()[0].getAttribute("aria-pressed")).toBe("false");
    expect(pointButtons()[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => confirm().click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("two");
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
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("one");
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
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("point-234");
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
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("point-234");
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
});
