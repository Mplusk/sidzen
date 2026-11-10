// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ quote: vi.fn(), order: vi.fn(), cart: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/ozon-delivery", () => ({ quoteOzonDelivery: m.quote }));
vi.mock("@/app/actions/checkout", () => ({ createOrderAction: m.order, createOrderWithState: m.order }));
vi.mock("@/app/actions/checkout-cart", () => ({ updateCheckoutCartGroup: m.cart }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("next/dynamic", async () => {
  const { useEffect, useRef, createElement } = await import("react");
  return { default: () => ({ points, selected, onSelect, initialBounds, onViewportChange }: { points: { id: string }[]; selected: string; onSelect: (id: string) => void; initialBounds?: { south: number; west: number; north: number; east: number }; onViewportChange?: (value: unknown) => void }) => {
    const sent = useRef(false);
    useEffect(() => { if (!sent.current && initialBounds && onViewportChange) { sent.current = true; onViewportChange({ bounds: initialBounds, zoom: 12 }); } }, [initialBounds, onViewportChange]);
    return createElement("div", null, ...points.map(point => createElement("button", { key: point.id, type: "button", "data-point": point.id, "aria-pressed": selected === point.id, onClick: () => onSelect(point.id) }, selected === point.id ? "✓ ПВЗ выбран" : "Выбрать этот ПВЗ")));
  } };
});
import { OzonDeliveryPicker } from "./ozon-delivery-picker";
import { CheckoutForm } from "./checkout-form";

const point = { id: "42", name: "Ozon", address: "Санкт-Петербург, Туристская улица, 4 корпус 1", type: "pvz", latitude: 60, longitude: 30.2 };
const city = { name: "Санкт-Петербург", bounds: { south: 59.7, west: 29.7, north: 60.3, east: 30.8 } };
let viewportPoints = [point];
const result = { token: "signed-fixture", cost: 0, days: 3, address: point.address };
let root: Root, container: HTMLDivElement;
let phone = "", packingReady = true;
const onQuote = vi.fn(), onEditPhone = vi.fn();
const scroll = vi.fn();
let frames: Map<number, FrameRequestCallback>;
async function flushFrames() { await act(async () => { for (const [id, callback] of frames) { frames.delete(id); callback(0); } }); }
const render = async () => act(async () => root.render(createElement(OzonDeliveryPicker, { phone, onEditPhone, onQuote, packingReady })));
const button = (text: string) => [...container.querySelectorAll("button")].find(value => value.textContent?.includes(text))!;
async function click(text: string) { await act(async () => button(text).click()); }
async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function waitViewport() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)); }); }
async function choosePoint() {
  await inputValue(container.querySelector<HTMLInputElement>(".ozon-point-search input")!, "Туристская");
  await click("Выбрать на карте");
  await waitViewport(); await vi.waitFor(() => expect(button("Выбрать этот ПВЗ")).toBeTruthy(), { timeout: 3000 });
  await click("Выбрать этот ПВЗ");
  await click("Выбрать этот пункт");
  await flushFrames();
}
async function consent() { await act(async () => container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.click()); }

describe("delivery verification interaction", () => {
  beforeEach(async () => {
    vi.resetAllMocks(); phone = ""; packingReady = true; container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = new Map(); let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    viewportPoints = [point];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.includes("view=city") ? { city, scope: "fixture" } : { points: viewportPoints, clusters: [], scope: "fixture" }))));
    m.quote.mockResolvedValue(result);
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("asks for a city and selects a point in the map dialog", async () => {
    expect(container.querySelector(".ozon-search-field label")?.textContent).toBe("Город");
    await inputValue(container.querySelector<HTMLInputElement>('.ozon-point-search input')!, "Санкт-Петербург");
    expect(fetch).not.toHaveBeenCalled();
    await click("Выбрать на карте");
    expect(container.querySelector("dialog")).toBeTruthy();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector(".ozon-point-confirmation")).toBeNull();
  });
  it("confirms a map selection and scrolls/focuses the next step without submitting or opening a keyboard", async () => {
    await inputValue(container.querySelector<HTMLInputElement>(".ozon-point-search input")!, "Туристская"); await click("Выбрать на карте");
    await waitViewport(); await vi.waitFor(() => expect(button("Выбрать этот ПВЗ")).toBeTruthy(), { timeout: 3000 }); await click("Выбрать этот ПВЗ");
    expect(container.querySelector(".ozon-point-confirmation")).toBeNull();
    expect(m.quote).not.toHaveBeenCalled();
    await click("Выбрать этот пункт"); await flushFrames();
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain("телефон");
    expect(document.activeElement).toBe(container.querySelector(".ozon-recipient-step"));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(m.quote).not.toHaveBeenCalled(); expect(m.order).not.toHaveBeenCalled();
    await click("Изменить"); await click("Выбрать этот пункт"); await flushFrames(); expect(scroll).toHaveBeenCalledTimes(2);
  });
  it("uses reduced motion and clears the selection when the city changes", async () => {
    vi.mocked(matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    await choosePoint(); expect(scroll).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain("ещё не проверены");
    await inputValue(container.querySelector<HTMLInputElement>(".ozon-point-search input")!, "Омск"); await flushFrames();
    expect(container.querySelector(".ozon-point-confirmation")).toBeNull(); expect(scroll).toHaveBeenCalledTimes(1);
    expect(button("Выбрать на карте")).toBeTruthy();
  });
  it("invalidates a checked quote on a different selection without sending the phone automatically", async () => {
    const other = { ...point, id: "43", address: "QA другой ПВЗ" };
    viewportPoints = [point, other];
    phone = "+7 (999) 123-45-67"; await render(); await choosePoint(); await consent(); await click("Проверить доставку");
    await click("Изменить"); await waitViewport(); await act(async () => container.querySelector<HTMLButtonElement>('button[data-point="43"]')!.click()); await click("Выбрать этот пункт"); await flushFrames();
    expect(onQuote).toHaveBeenLastCalledWith(null);
    expect(container.textContent).not.toContain("Проверка действительна"); expect(m.quote).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(other.address);
  });
  it("cancels pending scrolling when the picker unmounts", async () => {
    await inputValue(container.querySelector<HTMLInputElement>(".ozon-point-search input")!, "Туристская"); await click("Выбрать на карте");
    await waitViewport(); await vi.waitFor(() => expect(button("Выбрать этот ПВЗ")).toBeTruthy(), { timeout: 3000 }); await click("Выбрать этот ПВЗ"); await click("Выбрать этот пункт"); expect(frames.size).toBe(1);
    await act(async () => root.render(null)); expect(frames.size).toBe(0); expect(scroll).not.toHaveBeenCalled();
  });
  it("explains the missing phone instead of silently disabling the button; keeps the selected PVZ and consent", async () => {
    await choosePoint(); await consent();
    expect(button("Проверить доставку").disabled).toBe(false);
    await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("телефон"); expect(m.quote).not.toHaveBeenCalled();
    phone = "+7 (999) 123-45-67"; await render();
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address); expect(container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.checked).toBe(true);
    await click("Проверить доставку"); expect(m.quote).toHaveBeenCalledWith(phone, "42", true);
    expect(onQuote).toHaveBeenLastCalledWith(result); expect(container.textContent).toContain("Доставка бесплатная · 0 ₽");
    expect(container.textContent).toContain("Ozon подтвердил доступность доставки для этого номера.");
    phone = "+7 (999) 123-45-68"; await render();
    expect(container.textContent).not.toContain("Проверка действительна"); expect(container.textContent).not.toContain("Ozon подтвердил доступность доставки для этого номера."); expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
  });
  it("uses one recipient phone for Ozon and keeps the pickup point when it changes", async () => {
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "", email: "", phone: "" }, ozonDelivery: true })));
    expect(container.querySelector('[name="payment"]')).toBeNull(); expect(container.textContent).not.toContain("По счёту");
    await choosePoint(); await consent();
    expect(container.querySelectorAll('input[name="delivery"]')).toHaveLength(1);
    expect(container.querySelector<HTMLInputElement>('input[name="delivery"]')!.value).toBe("ozon-delivery");
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234567");
    expect(container.querySelector<HTMLInputElement>('input[name="phone"]')!.value).toBe("+7 (999) 123-45-67");
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address); expect(container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.checked).toBe(true);
    expect(container.querySelectorAll('input[type="tel"]')).toHaveLength(1);
    await click("Проверить доставку"); expect(container.querySelector<HTMLInputElement>('input[name="ozonQuote"]')!.value).toBe(result.token);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await inputValue(container.querySelector<HTMLInputElement>('input[name="phone"]')!, "89991234568");
    expect(container.querySelector<HTMLInputElement>('[name="phone"]')!.value).toBe("+7 (999) 123-45-68");
    expect(container.querySelector<HTMLInputElement>('input[name="ozonQuote"]')!.value).toBe("");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address); expect(container.textContent).not.toContain("Проверка действительна");
  });
  it("shows an invalid mobile phone at the field and does not check it with Ozon", async () => {
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "Покупатель", email: "buyer@example.test", phone: "" }, ozonDelivery: true })));
    const input = container.querySelector<HTMLInputElement>('[name="phone"]')!;
    await inputValue(input, "70000000000");
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(input.validity.patternMismatch).toBe(true);
    expect(input.parentElement?.textContent).toContain("российский мобильный номер");
    await choosePoint(); await consent();
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain("Доставка и телефон ещё не проверены");
    expect(m.quote).not.toHaveBeenCalled();
    await click("Проверить доставку");
    expect(m.quote).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  it("offers to edit the single phone when Ozon cannot confirm it, preserving the selection and consent", async () => {
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "Покупатель", email: "buyer@example.test", phone: "" }, ozonDelivery: true })));
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234567");
    await choosePoint(); await consent();
    m.quote.mockResolvedValueOnce({ error: "Ozon не подтвердил доставку для этого номера. Проверьте его или укажите другой номер, зарегистрированный в Ozon.", reason: "recipient" });
    await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("укажите другой номер");
    await click("Изменить телефон получателя");
    expect(document.activeElement).toBe(container.querySelector('[name="phone"]'));
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234568");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
    expect(container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.checked).toBe(true);
    await click("Проверить доставку");
    expect(m.quote).toHaveBeenLastCalledWith("+7 (999) 123-45-68", "42", true);
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe(result.token);
  });
  it("does not offer to place an order if the last delivery method is removed and Ozon is off", async () => {
    await act(async () => root.render(createElement(CheckoutForm, { items: [], methods: [], user: { name: "", email: "", phone: "" }, ozonDelivery: false })));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent).toBe("Доставка временно недоступна");
    expect(m.quote).not.toHaveBeenCalled();
  });
  it("invalidates a delivery quote when the cart quantity changes and keeps contact details", async () => {
    m.cart.mockResolvedValue({});
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "Покупатель", email: "buyer@example.test", phone: "" }, ozonDelivery: true })));
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234567");
    await choosePoint(); await consent(); await click("Проверить доставку");
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe(result.token);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Увеличить количество: Fixture"]')!.click());
    expect(m.cart).toHaveBeenCalledWith([{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], 2);
    expect(m.refresh).toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe("Покупатель");
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
  });
  it("ignores a delayed Ozon response for the previous cart after a new quote succeeds", async () => {
    m.cart.mockResolvedValue({});
    let finishOld!: (value: unknown) => void;
    m.quote.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "Покупатель", email: "buyer@example.test", phone: "" }, ozonDelivery: true })));
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234567");
    await choosePoint(); await consent(); await click("Проверить доставку");
    expect(button("Проверяем доставку").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Увеличить количество: Fixture"]')!.click());
    expect(button("Проверить доставку").disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe("");
    await click("Проверить доставку");
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe(result.token);
    await act(async () => finishOld({ ...result, token: "outdated-quote", days: 99 }));
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe(result.token);
    expect(container.textContent).not.toContain("99 дн.");
  });
  it("preserves contacts, comment, consent and selected PVZ after a server error and retries in place", async () => {
    m.order.mockResolvedValue({ error: "ozon-transport" });
    await act(async () => root.render(createElement(CheckoutForm, { items: [{ id: "fixture", name: "Fixture", configuration: "", quantity: 1, members: [{ id: "fixture", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], total: 240 }], methods: [], user: { name: "", email: "", phone: "" }, ozonDelivery: true })));
    await inputValue(container.querySelector<HTMLInputElement>('[name="name"]')!, "Тестовый покупатель");
    await inputValue(container.querySelector<HTMLInputElement>('[name="email"]')!, "buyer@example.test");
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234567");
    await act(async () => { const textarea = container.querySelector<HTMLTextAreaElement>('[name="comment"]')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Позвоните вечером"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector<HTMLInputElement>('[name="legal"]')!.click());
    await choosePoint(); await consent(); await click("Проверить доставку");
    await act(async () => container.querySelector<HTMLFormElement>('.checkout-form')!.requestSubmit());
    expect(m.order).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Введённые данные остались");
    expect(container.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe("Тестовый покупатель");
    expect(container.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe("buyer@example.test");
    expect(container.querySelector<HTMLTextAreaElement>('[name="comment"]')!.value).toBe("Позвоните вечером");
    expect(container.querySelector<HTMLInputElement>('[name="legal"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[name="ozonConsent"]')!.checked).toBe(true);
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
    m.order.mockResolvedValueOnce({ error: "ozon-expired" });
    await act(async () => container.querySelector<HTMLFormElement>('.checkout-form')!.requestSubmit());
    expect(m.order).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe("");
    expect(container.querySelector(".ozon-point-confirmation")?.textContent).toContain(point.address);
    expect(container.querySelector<HTMLInputElement>('[name="ozonConsent"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe("Тестовый покупатель");
    await click("Проверить доставку");
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe(result.token);
    m.order.mockResolvedValueOnce({ error: "ozon-recipient" });
    await act(async () => container.querySelector<HTMLFormElement>('.checkout-form')!.requestSubmit());
    expect(container.querySelector<HTMLInputElement>('[name="ozonQuote"]')!.value).toBe("");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("укажите другой номер");
    await click("Изменить телефон получателя");
    expect(document.activeElement).toBe(container.querySelector('[name="phone"]'));
    expect(container.querySelector<HTMLInputElement>('input[name="ozonConsent"]')!.checked).toBe(true);
    await inputValue(container.querySelector<HTMLInputElement>('[name="phone"]')!, "89991234568");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not send data without separate consent or valid packaging", async () => {
    phone = "+7 (999) 123-45-67"; await render(); await choosePoint(); await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("согласие"); expect(m.quote).not.toHaveBeenCalled();
    await consent(); packingReady = false; await render(); await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("упаковки"); expect(m.quote).not.toHaveBeenCalled();
  });
  it("shows progress and ignores a response for a phone edited during the check", async () => {
    phone = "+7 (999) 123-45-67"; await render(); await choosePoint(); await consent();
    let finish!: (value: unknown) => void; m.quote.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await click("Проверить доставку"); expect(container.textContent).toContain("Проверяем доступность"); expect(button("Проверяем доставку").disabled).toBe(true);
    phone = "+7 (999) 123-45-68"; await render();
    await act(async () => finish(result));
    expect(onQuote).not.toHaveBeenCalledWith(result); expect(button("Проверить доставку").disabled).toBe(false);
  });
  it("shows provider errors and permits a retry", async () => {
    phone = "+7 (999) 123-45-67"; await render(); await choosePoint(); await consent();
    m.quote.mockResolvedValueOnce({ error: "ПВЗ временно недоступен." }); await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("ПВЗ временно недоступен."); expect(button("Проверить доставку").disabled).toBe(false);
    m.quote.mockRejectedValueOnce(new Error("network")); await click("Проверить доставку");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Повторите попытку");
    await click("Проверить доставку"); expect(container.textContent).toContain("Доставка бесплатная · 0 ₽");
  });
  it("never requests device location and retains manual map search", async () => {
    const locate = vi.fn(); Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: locate } });
    await choosePoint(); expect(locate).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("view=city"))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("view=viewport"))).toBe(true);
    expect(container.textContent).not.toContain("рядом со мной"); expect(container.textContent).toContain("Изменить");
  });
});
