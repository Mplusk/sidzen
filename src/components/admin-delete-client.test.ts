// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("@/app/actions/clients", () => ({ changeClientArchive: vi.fn() }));
import { AdminDeleteClient } from "./admin-delete-client";
it("shows a reversible deletion confirmation and cancel does not submit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"), close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AdminDeleteClient, { clientKey: "account:qa", name: "QA Client" })));
    const dialog = host.querySelector("dialog")!; expect(dialog.open).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>(".admin-delete-link")!.click()); expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("аккаунт для входа останутся без изменений");
    const confirm = host.querySelector<HTMLButtonElement>('button[name="confirmation"]')!; expect(confirm.value).toBe("archive");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Отмена")!.click()); expect(dialog.open).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});
