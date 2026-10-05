// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/app/actions/integrations", () => ({ deleteDeliveryMethod: vi.fn() }));
import { AdminDeleteDelivery } from "./admin-delete-delivery";

it("requires opening the confirmation dialog; cancel does not submit deletion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const originalOpen = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  const open = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  const close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: open });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(AdminDeleteDelivery, { id: "method-1", name: "СДЭК" })));
    expect(container.querySelector("dialog")!.open).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-delete-link')!.click());
    expect(open).toHaveBeenCalledOnce(); expect(container.querySelector("dialog")!.open).toBe(true);
    expect(container.querySelector("dialog")!.textContent).toContain("Старые заказы");
    const confirm = container.querySelector<HTMLButtonElement>('button[name="confirmation"]')!;
    expect(confirm.type).toBe("submit"); expect(confirm.value).toBe("method-1");
    await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Отмена")!.click());
    expect(close).toHaveBeenCalledOnce(); expect(container.querySelector("dialog")!.open).toBe(false);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
    if (originalOpen) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalOpen); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});
