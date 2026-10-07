// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const status = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async importActual => ({ ...await importActual<typeof import("react-dom")>(), useFormStatus: () => status }));
import { SubmitButton } from "./submit-button";
import { ValidatedInput } from "./validated-input";
import { ConfirmAction } from "./confirm-action";
let root: Root, container: HTMLDivElement;
beforeEach(() => { status.pending = false; vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("preserves the submitter intent and offers an explicit pending state", async () => {
  const view = () => createElement("form", null, createElement(SubmitButton, { name: "intent", value: "check", pendingLabel: "Проверяем…" }, "Проверить"));
  await act(async () => root.render(view()));
  const button = container.querySelector("button")!;
  expect(new FormData(container.querySelector("form")!, button).get("intent")).toBe("check");
  expect(button.disabled).toBe(false); expect(button.textContent).toBe("Проверить");
  status.pending = true; await act(async () => root.render(view()));
  expect(button.disabled).toBe(true); expect(button.getAttribute("aria-busy")).toBe("true"); expect(button.textContent).toBe("Проверяем…");
});
it("does not announce errors before interaction; explains required/email errors on blur and clears them while correcting", async () => {
  await act(async () => root.render(createElement(ValidatedInput, { name: "email", type: "email", required: true, "aria-describedby": "existing-hint" })));
  const input = container.querySelector("input")!;
  expect(container.querySelector(".field-error")).toBeNull();
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(input.getAttribute("aria-invalid")).toBe("true"); expect(container.textContent).toContain("Заполните это поле.");
  const error = container.querySelector("small")!;
  expect(input.getAttribute("aria-describedby")).toBe(`existing-hint ${error.id}`);
  await act(async () => { input.value = "incorrect"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.textContent).toContain("name@example.ru");
  await act(async () => { input.value = "qa@example.test"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(input.getAttribute("aria-invalid")).toBeNull(); expect(input.getAttribute("aria-describedby")).toBe("existing-hint"); expect(container.querySelector("small")).toBeNull();
});
it("uses a labelled native dialog, safe initial focus and non-submitting cancel", async () => {
  const open = vi.fn(function(this: HTMLDialogElement) { this.open = true; });
  const close = vi.fn(function(this: HTMLDialogElement) { this.open = false; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: open });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  const action = vi.fn();
  await act(async () => root.render(createElement(ConfirmAction, { title: "Удалить отзыв?", description: "Удалятся фотографии.", trigger: "Удалить", confirmLabel: "Да, удалить", action }, createElement("input", { type: "hidden", name: "confirmation", value: "delete-review" }))));
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(false); expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("Удалить отзыв?");
  await act(async () => container.querySelector<HTMLButtonElement>(".admin-delete-link")!.click());
  expect(dialog.open).toBe(true);
  const cancel = [...container.querySelectorAll("button")].find(button => button.textContent === "Отмена")!;
  expect(cancel.type).toBe("button"); expect(document.activeElement).toBe(cancel);
  await act(async () => cancel.click());
  expect(dialog.open).toBe(false); expect(action).not.toHaveBeenCalled();
});
it("explains why a referenced catalog element cannot be deleted", async () => {
  await act(async () => root.render(createElement(ConfirmAction, { title: "Удалить?", description: "Необратимо", trigger: "Удалить", confirmLabel: "Да", action: vi.fn(), disabled: true, hint: "Сначала уберите связи." })));
  const trigger = container.querySelector<HTMLButtonElement>(".admin-delete-link")!;
  expect(trigger.disabled).toBe(true); expect(document.getElementById(trigger.getAttribute("aria-describedby")!)!.textContent).toContain("уберите связи");
});
