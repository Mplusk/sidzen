import { afterEach, describe, expect, it, vi } from "vitest";
import { approximatePosition, deliveryCheckIssue, geolocationErrorMessage, locateDevice, withDeliveryDeadline } from "./picker-state";

describe("delivery picker prerequisites and private geolocation", () => {
  afterEach(() => vi.useRealTimers());
  it("explains missing phone, point, consent and packing instead of silently disabling", () => {
    expect(deliveryCheckIssue("", "42", true, true)).toContain("Телефон".toLowerCase());
    expect(deliveryCheckIssue("+7 (999) 123-45", "42", true, true)).toContain("полностью");
    expect(deliveryCheckIssue("+79991234567", "", true, true)).toContain("Выберите");
    expect(deliveryCheckIssue("+79991234567", "42", false, true)).toContain("согласие");
    expect(deliveryCheckIssue("+79991234567", "42", true, false)).toContain("упаковки");
    expect(deliveryCheckIssue("+7 (999) 123-45-67", "42", true, true)).toBe("");
    expect(deliveryCheckIssue("+19991234567", "42", true, true)).not.toBe("");
  });
  it("rounds before sending and rejects invalid coordinates", () => {
    expect(approximatePosition(44.990127, 38.951795)).toEqual({ latitude: 44.99, longitude: 38.952 });
    for (const position of [[91, 0], [0, 181], [NaN, 1], [1, Infinity]]) expect(() => approximatePosition(...position as [number, number])).toThrow();
  });
  it("bounds permission waiting and supports cancellation", async () => {
    vi.useFakeTimers();
    const api = { getCurrentPosition: vi.fn() };
    const controller = new AbortController();
    const canceled = locateDevice(api, controller.signal);
    const rejected = expect(canceled).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
    const timeout = locateDevice(api, new AbortController().signal);
    const timedOut = expect(timeout).rejects.toMatchObject({ code: 3 }); await vi.advanceTimersByTimeAsync(16000); await timedOut;
  });
  it("requires invocation, uses low accuracy, handles denial and returns approximate position", async () => {
    const api = { getCurrentPosition: vi.fn((success: PositionCallback) => success({ coords: { latitude: 44.990127, longitude: 38.951795 } } as GeolocationPosition)) };
    expect(api.getCurrentPosition).not.toHaveBeenCalled();
    expect(await locateDevice(api, new AbortController().signal)).toEqual({ latitude: 44.99, longitude: 38.952 });
    expect(api.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    expect(geolocationErrorMessage(1)).toContain("запрещён"); expect(geolocationErrorMessage(3)).toContain("12 секунд");
  });
  it("limits stuck delivery checks to one minute and clears successful timers", async () => {
    vi.useFakeTimers();
    const waiting = withDeliveryDeadline(new Promise(() => {}));
    const failed = expect(waiting).rejects.toThrow("timed out"); await vi.advanceTimersByTimeAsync(60000); await failed;
    expect(await withDeliveryDeadline(Promise.resolve("ok"))).toBe("ok"); expect(vi.getTimerCount()).toBe(0);
  });
});
