// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/checkout-cart", () => ({ updateCheckoutCartGroup: m.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { CartQuantityControl } from "./cart-quantity-control";

let container: HTMLDivElement, root: Root;
async function render(quantity: number, max: number, canAdjust = true) {
  await act(async () => root.render(createElement(CartQuantityControl, { members: [{ id: "item", quantity, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], name: "Светильник", quantity, max, canAdjust })));
}
const control = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label} количество: Светильник"]`)!;
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Количество товара: Светильник"]')!;
async function type(value: string) {
  await act(async () => { const field = input(); field.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => { vi.resetAllMocks(); m.update.mockResolvedValue({}); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("cart quantity controls", () => {
  it("updates quantity, refreshes the total and respects the stock limit", async () => {
    await render(1, 2); expect(control("Уменьшить").disabled).toBe(true);
    await act(async () => control("Увеличить").click());
    expect(m.update).toHaveBeenCalledWith([{ id: "item", quantity: 1, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], 2); expect(m.refresh).toHaveBeenCalled();
    await render(2, 2); expect(control("Увеличить").disabled).toBe(true);
    await act(async () => control("Уменьшить").click()); expect(m.update).toHaveBeenLastCalledWith([{ id: "item", quantity: 2, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], 1);
  });
  it("reduces a quantity above the new stock directly to the available amount", async () => {
    await render(5, 2); expect(control("Увеличить").disabled).toBe(true);
    await act(async () => control("Уменьшить").click()); expect(m.update).toHaveBeenCalledWith([{ id: "item", quantity: 5, revision: "2030-01-01T00:00:00.000Z", state: "a".repeat(64) }], 2);
  });
  it("reports a server error and refreshes stale cart data", async () => {
    m.update.mockResolvedValueOnce({ error: "Корзина изменилась. Проверьте состав заказа." });
    await render(1, 3); await act(async () => control("Увеличить").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Корзина изменилась"); expect(m.refresh).toHaveBeenCalled();
    await render(1, 0, false); expect(control("Уменьшить").disabled).toBe(true); expect(control("Увеличить").disabled).toBe(true);
  });
  it("saves a typed integer on Enter or blur without submitting on every digit", async () => {
    await render(1, 10); await type("5");
    expect(m.update).not.toHaveBeenCalled();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => input().dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(m.update).toHaveBeenCalledWith(expect.any(Array), 5); expect(m.refresh).toHaveBeenCalled();
    await render(5, 10); await type("7");
    await act(async () => input().blur());
    expect(m.update).toHaveBeenLastCalledWith(expect.any(Array), 7);
  });
  it("rejects invalid quantities and cancels an edit with Escape", async () => {
    await render(2, 5);
    for (const value of ["0", "6", "1.5", ""]) {
      await type(value); await act(async () => input().blur());
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("от 1 до 5");
      expect(input().value).toBe(value); expect(input().validity.valid).toBe(false); expect(m.update).not.toHaveBeenCalled();
    }
    await type("4");
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(input().value).toBe("2"); expect(m.update).not.toHaveBeenCalled();
    await render(2, 5, false); expect(input().disabled).toBe(true);
  });
  it("does not submit an intermediate draft when the plus button is clicked", async () => {
    await render(1, 10); await type("4");
    await act(async () => { const plus = control("Увеличить"); plus.dispatchEvent(new Event("pointerdown", { bubbles: true })); input().blur(); plus.click(); });
    expect(m.update).toHaveBeenCalledTimes(1); expect(m.update).toHaveBeenCalledWith(expect.any(Array), 5);
  });
  it("discards an invalid draft when the available stock changes", async () => {
    await render(2, 5); await type("6"); await act(async () => input().blur());
    expect(input().validity.valid).toBe(false);
    await render(2, 3);
    expect(input().value).toBe("2"); expect(input().validity.valid).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(m.update).not.toHaveBeenCalled();
  });
});
