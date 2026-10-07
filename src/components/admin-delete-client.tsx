"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { changeClientArchive } from "@/app/actions/clients";

function ConfirmButton({ restore }: { restore: boolean }) {
  const { pending } = useFormStatus();
  const operation = restore ? "restore" : "archive";
  return <button className={`button ${restore ? "" : "button--danger"}`} type="submit" name="confirmation" value={operation} disabled={pending}>{pending ? "Сохраняем…" : restore ? "Да, восстановить" : "Да, удалить клиента"}</button>;
}

export function AdminDeleteClient({ clientKey, name, restore = false }: { clientKey: string; name: string; restore?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId(), description = useId();
  return <>
    <button type="button" className="admin-delete-link" aria-label={`${restore ? "Восстановить" : "Удалить"} клиента ${name}`} onClick={() => dialog.current?.showModal()}>{restore ? "Восстановить" : "Удалить"}</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>{restore ? "Восстановить" : "Удалить"} клиента {name}?</h2>
      <p id={description}>{restore ? "Карточка вернётся в основной список клиентов." : "Карточка исчезнет из основного списка. Заказы, документы, контакты в заказах и аккаунт для входа останутся без изменений. Карточку можно восстановить в разделе «Удалённые». Это не полное удаление персональных данных."}</p>
      <form action={changeClientArchive}>
        <input type="hidden" name="clientKey" value={clientKey} />
        <input type="hidden" name="operation" value={restore ? "restore" : "archive"} />
        <div className="confirm-dialog__actions"><button type="button" className="button button--outline" autoFocus onClick={() => dialog.current?.close()}>Отмена</button><ConfirmButton restore={restore} /></div>
      </form>
    </dialog>
  </>;
}
