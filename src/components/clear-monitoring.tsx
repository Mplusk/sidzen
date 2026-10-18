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
      <h2 id={id}>Очистить все счётчики просмотров?</h2><p>Общие счётчики страниц и товаров за все дни будут обнулены, включая скрытые выбранным периодом. Восстановить их нельзя. Заказы, клиенты и другие логи сохранятся. Новые открытия страниц начнут учитываться с нуля.</p>
      <form action={clearMonitoring}><div className="confirm-dialog__actions"><button autoFocus type="button" className="button button--outline" onClick={() => dialog.current?.close()}>Отмена</button><Confirm /></div></form>
    </dialog></>;
}
