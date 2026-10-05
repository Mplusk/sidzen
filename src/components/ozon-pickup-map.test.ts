// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ markers: [] as { content: HTMLElement; element: HTMLElement; remove: () => void; openPopup: () => void }[], map: { fitBounds: vi.fn(), panTo: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn() } }));
vi.mock("leaflet", () => ({ default: {
  map: () => m.map, divIcon: vi.fn(), latLngBounds: (values: unknown) => values,
  tileLayer: () => ({ addTo: () => ({ on: vi.fn() }) }),
  marker: () => {
    const state = { content: document.createElement("div") as HTMLElement, element: document.createElement("div"), remove: vi.fn(), openPopup: vi.fn() };
    m.markers.push(state);
    const marker = { bindPopup: (content: HTMLElement) => { state.content = content; return marker; }, addTo: () => marker, getElement: () => state.element, remove: state.remove, openPopup: state.openPopup };
    return marker;
  },
} }));
import OzonPickupMap from "./ozon-pickup-map";
const points = [42, 43].map(id => ({ id: String(id), name: "ПВЗ Ozon", address: `QA адрес ${id}`, type: "pvz", latitude: 60, longitude: 30.2 + id / 10000 }));
let root: Root, container: HTMLDivElement;
const select = vi.fn();
async function render(selected: string) { await act(async () => root.render(createElement(OzonPickupMap, { points, selected, onSelect: select }))); }
const popupButton = (index: number) => m.markers[index].content.querySelector("button")!;
beforeEach(() => {
  vi.clearAllMocks(); m.markers.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("pickup map selection feedback", () => {
  it("immediately changes the clicked popup button and synchronizes selection from the parent/list", async () => {
    await render(""); expect(popupButton(0).getAttribute("aria-pressed")).toBe("false");
    popupButton(0).click(); expect(select).toHaveBeenCalledWith("42");
    expect(popupButton(0).textContent).toBe("✓ ПВЗ выбран"); expect(popupButton(0).classList.contains("ozon-point-button--selected")).toBe(true);
    await render("42"); expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    await render("43"); expect(popupButton(0).textContent).toBe("Выбрать этот ПВЗ"); expect(popupButton(0).getAttribute("aria-pressed")).toBe("false");
    expect(popupButton(1).textContent).toBe("✓ ПВЗ выбран"); expect(popupButton(1).getAttribute("aria-pressed")).toBe("true");
    expect(m.markers[1].openPopup).toHaveBeenCalled();
    await render(""); expect(popupButton(1).classList.contains("ozon-point-button--selected")).toBe(false);
  });
});
