// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => {
  let index = 0;
  return { default: () => {
    const yandex = index++ === 1;
    return (props: { onError?: () => void }) => createElement("button", { type: "button", onClick: props.onError, "data-map": yandex ? "yandex" : "fallback" }, yandex ? "Карта Яндекса" : "Другая карта");
  } };
});
import PickupMapProvider from "./pickup-map-provider";

const points = [{ id: "42", name: "ПВЗ", address: "Омск", type: "pvz", latitude: 55, longitude: 73 }];
let root: Root, container: HTMLDivElement;
const onSelect = vi.fn();
async function render() { await act(async () => root.render(createElement(PickupMapProvider, { points, selected: "", onSelect, carrier: "Ozon" }))); }
async function click(text: string) { await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click()); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ apiKey: "test-public-key" })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("Yandex map consent and fallback", () => {
  it("does not load Yandex until the visitor explicitly agrees", async () => {
    await render();
    expect(container.querySelector('[data-map="yandex"]')).toBeNull();
    expect(container.textContent).toContain("IP-адрес");
    await click("Разрешить и показать");
    expect(container.querySelector('[data-map="yandex"]')).toBeTruthy();
  });
  it("offers another map without sending data to Yandex", async () => {
    await render(); await click("Другая карта");
    expect(container.querySelector('[data-map="fallback"]')).toBeTruthy();
    expect(container.querySelector('[data-map="yandex"]')).toBeNull();
  });
  it("falls back if the key is missing or the Yandex API fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ apiKey: "" }));
    await render(); expect(container.querySelector('[data-map="fallback"]')).toBeTruthy();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(); await click("Разрешить и показать"); await click("Карта Яндекса");
    expect(container.querySelector('[data-map="fallback"]')).toBeTruthy();
    expect(container.textContent).toContain("временно недоступны");
  });
});
