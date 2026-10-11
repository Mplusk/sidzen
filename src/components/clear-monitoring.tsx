"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { clearMonitoring } from "@/app/actions/monitoring";
function Confirm() {
  const { pending } = useFormStatus();
  return <button type="submit" className="button button--danger" name="confirmation" value="clear-all-monitoring" disabled={pending}>{pending ? "Удаляем…" : "Да, очистить мониторинг"}</button>;
}
export function ClearMonitoring() {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  return <><button type="button" className="button button--outline" onClick={() => dialog.current?.showModal()}>Очистить мониторинг</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={id}>
      <h2 id={id}>Очистить весь мониторинг?</h2><p>Все визиты, IP, источники, просмотры и согласия на статистику будут удалены, включая скрытые фильтрами. Восстановить их нельзя. Заказы, клиенты и другие логи сохранятся. Сбор новых визитов продолжится после нового согласия посетителей.</p>
      <form action={clearMonitoring}><div className="confirm-dialog__actions"><button autoFocus type="button" className="button button--outline" onClick={() => dialog.current?.close()}>Отмена</button><Confirm /></div></form>
    </dialog></>;
}
