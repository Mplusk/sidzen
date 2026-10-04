// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock("@/app/actions/ozon-delivery", () => ({ quoteOzonDelivery: m.quote }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { OzonDeliveryPicker } from "./ozon-delivery-picker";

const point = { id: "42", name: "Ozon", address: "Яблоновский, Гагарина, 190/2", type: "pvz", latitude: 44.99, longitude: 38.95 };
let root: Root, container: HTMLDivElement;
let phone = "";
const onQuote = vi.fn();
const render = async () => act(async () => root.render(createElement(OzonDeliveryPicker, { phone, onQuote })));
const button = (text: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.includes(text))!;
async function click(text: string) { await act(async () => button(text).click()); }
async function choosePoint() {
  const input = container.querySelector<HTMLInputElement>('.ozon-point-search input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Яблоновский"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("Найти ПВЗ на карте");
  await act(async () => { const select = container.querySelector("select")!; select.value = "42"; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function consent() { await act(async () => container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.click()); }
describe("Ozon checkout interaction regressions", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); phone = ""; container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ points: [point] })));
    m.quote.mockResolvedValue({ token: "signed-fixture", cost: 0, days: 3, address: point.address });
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it("explains why checking does nothing without a complete phone and never sends it to Ozon", async () => {
    await choosePoint(); await consent();
    expect(button("Проверить доставку").disabled).toBe(false);
    await click("Проверить доставку"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("телефон"); expect(m.quote).not.toHaveBeenCalled();
    phone = "+7 (999) 123-45-67"; await render();
    expect(container.textContent).not.toContain("Заполните телефон");
    expect(container.querySelector("select")!.value).toBe("42"); expect(container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.checked).toBe(true);
    await click("Проверить доставку"); expect(m.quote).toHaveBeenCalledWith(phone, "42", true); expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({ token: "signed-fixture", cost: 0 }));
    expect(container.textContent).toContain("Доставка бесплатная · 0 ₽");
    phone = "+7 (999) 123-45-68"; await render(); expect(container.textContent).not.toContain("Проверка действительна"); expect(container.querySelector("select")!.value).toBe("42");
  });
  it("shows progress and ignores a response for a phone edited during the check", async () => {
    phone = "+7 (999) 123-45-67"; await render(); await choosePoint(); await consent();
    let finish!: (value: unknown) => void; m.quote.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await click("Проверить доставку"); expect(container.textContent).toContain("Проверяем доступность");
    phone = "+7 (999) 123-45-68"; await render();
    await act(async () => finish({ token: "old", cost: 0, days: 3, address: point.address }));
    expect(onQuote).not.toHaveBeenCalledWith(expect.objectContaining({ token: "old" })); expect(button("Проверить доставку").disabled).toBe(false);
  });
  it("does not request location before separate permission; rejection leaves manual search available", async () => {
    const locate = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => failure({ code: 1 } as GeolocationPositionError));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: locate } });
    await click("ПВЗ рядом со мной"); expect(locate).not.toHaveBeenCalled(); expect(container.textContent).toContain("не сохраняются");
    await click("Разрешить и найти ПВЗ"); expect(locate).toHaveBeenCalledTimes(1); expect(container.querySelector('[role="alert"]')?.textContent).toContain("запрещён"); expect(fetch).not.toHaveBeenCalled();
    await choosePoint(); expect(container.querySelector("select")!.value).toBe("42");
  });
  it("finds nearby points without any town or phone and sends approximate coordinates in a private POST", async () => {
    const locate = vi.fn((success: PositionCallback) => success({ coords: { latitude: 44.990127, longitude: 38.951795 } } as GeolocationPosition));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: locate } });
    vi.mocked(fetch).mockResolvedValue(Response.json({ points: [{ ...point, distanceKm: 0.5 }], nearby: true }));
    await click("ПВЗ рядом со мной"); await click("Разрешить и найти ПВЗ");
    expect(fetch).toHaveBeenCalledWith("/api/delivery/ozon/points/", expect.objectContaining({ method: "POST", cache: "no-store", body: '{"latitude":44.99,"longitude":38.952}' }));
    expect(container.textContent).toContain("Ближайшие ПВЗ"); expect(container.querySelector("select")!.textContent).toContain("≈ 0.5 км"); expect(m.quote).not.toHaveBeenCalled();
  });
});
