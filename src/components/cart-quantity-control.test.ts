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
});

