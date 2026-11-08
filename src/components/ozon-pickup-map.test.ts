// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ markers: [] as { content: HTMLElement; element: HTMLElement; remove: () => void; openPopup: () => void; bindPopup: ReturnType<typeof vi.fn>; click?: () => void; add?: () => void }[], map: { fitBounds: vi.fn(), panTo: vi.fn(), remove: vi.fn(), invalidateSize: vi.fn() }, addLayer: vi.fn(), zoomToShowLayer: vi.fn(), removeClusters: vi.fn() }));
vi.mock("leaflet.markercluster", () => ({}));
vi.mock("leaflet", () => ({ default: {
  map: () => m.map, divIcon: vi.fn(), latLngBounds: (values: unknown) => values,
  tileLayer: () => ({ addTo: () => ({ on: vi.fn() }) }),
  markerClusterGroup: () => {
    const group = { addTo: () => group, addLayer: m.addLayer, zoomToShowLayer: m.zoomToShowLayer, remove: m.removeClusters };
    return group;
  },
  marker: () => {
    const state = { content: document.createElement("div") as HTMLElement, element: document.createElement("div"), remove: vi.fn(), openPopup: vi.fn(), bindPopup: vi.fn(), click: undefined as (() => void) | undefined, add: undefined as (() => void) | undefined };
    m.markers.push(state);
    const marker = { bindPopup: (content: HTMLElement) => { state.bindPopup(content); state.content = content; return marker; }, on: (event: string, handler: () => void) => { if (event === "click") state.click = handler; if (event === "add") state.add = handler; return marker; }, addTo: () => marker, getElement: () => state.element, remove: state.remove, openPopup: state.openPopup };
    return marker;
  },
} }));
import OzonPickupMap from "./ozon-pickup-map";
const points = [42, 43].map(id => ({ id: String(id), name: "ПВЗ Ozon", address: `QA адрес ${id}`, type: "pvz", latitude: 60, longitude: 30.2 + id / 10000 }));
let root: Root, container: HTMLDivElement;
const select = vi.fn();
async function render(selected: string, openPopupOnSelect = true) { await act(async () => root.render(createElement(OzonPickupMap, { points, selected, onSelect: select, openPopupOnSelect }))); }
const popupButton = (index: number) => m.markers[index].content.querySelector("button")!;
beforeEach(() => {
  vi.clearAllMocks(); m.markers.length = 0;
  m.zoomToShowLayer.mockImplementation((_marker, callback) => callback());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("pickup map selection feedback", () => {
  it("restores the current selection when clustering recreates marker elements", async () => {
    await render("42", false);
    m.markers[0].element = document.createElement("div");
    expect(m.markers[0].add).toBeTypeOf("function");
    m.markers[0].add!();
    expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    await render("43", false);
    for (const marker of m.markers) {
      marker.element = document.createElement("div");
      marker.add!();
    }
    expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(false);
    expect(m.markers[1].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(m.markers[1].openPopup).not.toHaveBeenCalled();
  });
  it("highlights a clicked marker in dialog mode without opening a second selection popup", async () => {
    await render("", false);
    expect(m.markers[0].bindPopup).not.toHaveBeenCalled();
    expect(m.markers[0].click).toBeTypeOf("function");
    await act(async () => m.markers[0].click!());
    expect(select).toHaveBeenCalledExactlyOnceWith("42");
    await render("42", false);
    expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    expect(m.markers[0].openPopup).not.toHaveBeenCalled();
    await render("43", false);
    expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(false);
    expect(m.markers[1].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("immediately changes the clicked popup button and synchronizes selection from the parent/list", async () => {
    await render(""); expect(m.addLayer).toHaveBeenCalledTimes(2); expect(popupButton(0).getAttribute("aria-pressed")).toBe("false");
    popupButton(0).click(); expect(select).toHaveBeenCalledWith("42");
    expect(popupButton(0).textContent).toBe("✓ ПВЗ выбран"); expect(popupButton(0).classList.contains("ozon-point-button--selected")).toBe(true);
    await render("42"); expect(m.markers[0].element.classList.contains("ozon-map-pin--selected")).toBe(true);
    await render("43"); expect(popupButton(0).textContent).toBe("Выбрать этот ПВЗ"); expect(popupButton(0).getAttribute("aria-pressed")).toBe("false");
    expect(popupButton(1).textContent).toBe("✓ ПВЗ выбран"); expect(popupButton(1).getAttribute("aria-pressed")).toBe("true");
    expect(m.zoomToShowLayer).toHaveBeenCalled(); expect(m.markers[1].openPopup).toHaveBeenCalled();
    await render(""); expect(popupButton(1).classList.contains("ozon-point-button--selected")).toBe(false);
  });
});
