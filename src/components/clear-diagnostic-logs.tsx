"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { clearDiagnosticLogs } from "@/app/actions/diagnostics";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="button button--danger" name="confirmation" value="delete-all-diagnostic-logs" disabled={pending}>{pending ? "Удаление…" : "Да, удалить все логи"}</button>;
}
export function ClearDiagnosticLogs() {
  const dialog = useRef<HTMLDialogElement>(null), title = useId(), description = useId();
  return <><button className="button button--outline" type="button" onClick={() => dialog.current?.showModal()}>Удалить все логи</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>Удалить все логи?</h2>
      <p id={description}>Будут удалены все записи диагностического журнала, включая скрытые фильтрами. Восстановить их через сайт нельзя. Заказы, платежи, чеки и журнал аудита не изменятся. Новые события продолжат записываться.</p>
      <form action={clearDiagnosticLogs}><div className="confirm-dialog__actions"><button autoFocus className="button button--outline" type="button" onClick={() => dialog.current?.close()}>Отмена</button><ConfirmButton /></div></form>
    </dialog></>;
}
