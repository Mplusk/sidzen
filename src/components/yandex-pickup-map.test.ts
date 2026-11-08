// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YandexPickupMap from "./yandex-pickup-map";

const points = [42, 43].map(id => ({ id: String(id), name: "ПВЗ", address: "Тестовый адрес", type: "pvz", latitude: 55, longitude: 73 + id / 10000 }));
const onSelect = vi.fn(), onError = vi.fn(), destroy = vi.fn(), setCenter = vi.fn(), setBounds = vi.fn();
let marks: { click?: () => void; set: ReturnType<typeof vi.fn> }[], root: Root, container: HTMLDivElement;
async function render(selected: string) {
  await act(async () => root.render(createElement(YandexPickupMap, { apiKey: "public-test-key", points, selected, onSelect, onError, carrier: "Ozon" })));
}
beforeEach(() => {
  marks = []; vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ymaps", {
    Map: class { geoObjects = { add: vi.fn() }; behaviors = { disable: vi.fn() }; destroy = destroy; setCenter = setCenter; setBounds = setBounds; },
    Clusterer: class { add = vi.fn(); },
    Placemark: class {
      private state = { click: undefined as (() => void) | undefined, set: vi.fn() };
      events = { add: (_name: string, click: () => void) => { this.state.click = click; } };
      options = { set: this.state.set };
      constructor() { marks.push(this.state); }
    },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("Yandex pickup map", () => {
  it("clusters points, selects a clicked marker and synchronizes list selection", async () => {
    await render(""); expect(marks).toHaveLength(2); expect(setBounds).toHaveBeenCalledOnce();
    marks[0].click?.(); expect(onSelect).toHaveBeenCalledWith("42");
    await render("43");
    expect(marks[1].set).toHaveBeenCalledWith("iconColor", "#6b6f5b");
    expect(setCenter).toHaveBeenCalledWith([points[1].latitude, points[1].longitude], 15, expect.any(Object));
  });
  it("destroys the map on unmount", async () => {
    await render(""); await act(async () => root.render(null)); expect(destroy).toHaveBeenCalledOnce();
  });
});
