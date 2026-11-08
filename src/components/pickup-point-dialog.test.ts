// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { PickupPointDialog } from "./pickup-point-dialog";

const points = [
  { id: "one", name: "Пункт на Морской", address: "Санкт-Петербург, Большая Морская улица, 34", type: "pvz", latitude: 59.93, longitude: 30.30 },
  { id: "two", name: "Пункт на Невском", address: "Санкт-Петербург, Невский проспект, 11", type: "pvz", latitude: 59.94, longitude: 30.31, workTime: "Пн–Вс 09:00–21:00" },
];
const onSelect = vi.fn(), onClose = vi.fn();
let root: Root, container: HTMLDivElement;
const pointButtons = () => [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
const confirm = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Выбрать пункт")!;
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
});
