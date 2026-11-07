import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryCheckIssue, withDeliveryDeadline } from "./picker-state";

describe("delivery prerequisites and deadline", () => {
  afterEach(() => vi.useRealTimers());
  it("accepts only complete Russian phone numbers and explains every prerequisite", () => {
    expect(deliveryCheckIssue("+7 (999) 123-45-67", "42", true, true)).toBe("");
    expect(deliveryCheckIssue("89991234567", "42", true, true)).toBe("");
    for (const phone of ["", "+7", "+7 (999) 123", "+1 (999) 123-45-67", "+799912345678", "+7 (000) 000-00-00", "+7 (495) 123-45-67"]) expect(deliveryCheckIssue(phone, "42", true, true)).toContain("телефон");
    expect(deliveryCheckIssue("89991234567", "", true, true)).toContain("пункт");
    expect(deliveryCheckIssue("89991234567", "42", false, true)).toContain("согласие");
    expect(deliveryCheckIssue("89991234567", "42", true, false)).toContain("упаковки");
  });
  it("does not wait forever for a stalled delivery check", async () => {
    vi.useFakeTimers();
    const request = withDeliveryDeadline(new Promise(() => {}));
    const assertion = expect(request).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(60000); await assertion; expect(vi.getTimerCount()).toBe(0);
  });
  it("clears its timer when a request finishes or fails", async () => {
    vi.useFakeTimers(); await expect(withDeliveryDeadline(Promise.resolve("ok"))).resolves.toBe("ok");
    await expect(withDeliveryDeadline(Promise.reject(new Error("network")))).rejects.toThrow("network"); expect(vi.getTimerCount()).toBe(0);
  });
});
