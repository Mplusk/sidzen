"use client";

import { useId, useRef, type ComponentProps, type ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

export function ConfirmAction({ title, description, trigger, confirmLabel, action, children, disabled = false, hint }: {
  title: string; description: string; trigger: string; confirmLabel: string;
  action: ComponentProps<"form">["action"]; children?: ReactNode; disabled?: boolean; hint?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId(), hintId = useId();
  return <>
    <button type="button" className="admin-delete-link" disabled={disabled} aria-describedby={hint ? hintId : undefined} onClick={() => { dialog.current?.showModal(); cancel.current?.focus({ preventScroll: true }); }}>{trigger}</button>
    {hint && <small id={hintId} className="muted">{hint}</small>}
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>
      <form action={action}>{children}<div className="confirm-dialog__actions">
        <button ref={cancel} type="button" className="button button--outline" autoFocus onClick={() => dialog.current?.close()}>Отмена</button>
        <SubmitButton className="button button--danger" pendingLabel="Удаляем…">{confirmLabel}</SubmitButton>
      </div></form>
    </dialog>
  </>;
}
