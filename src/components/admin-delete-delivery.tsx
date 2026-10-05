"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { deleteDeliveryMethod } from "@/app/actions/integrations";

function ConfirmButton({ id }: { id: string }) {
  const { pending } = useFormStatus();
  return <button className="button button--danger" type="submit" name="confirmation" value={id} disabled={pending}>{pending ? "Удаление…" : "Да, удалить способ доставки"}</button>;
}

export function AdminDeleteDelivery({ id, name }: { id: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(), description = useId();
  return <>
    <button type="button" className="admin-delete-link" aria-label={`Удалить доставку «${name}»`} onClick={() => dialog.current?.showModal()}>Удалить способ доставки</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>Удалить «{name}»?</h2>
      <p id={description}>Этот способ исчезнет из настроек и оформления новых заказов. Старые заказы и сведения об их доставке не изменятся. Новый способ можно добавить в этом разделе.</p>
      <form action={deleteDeliveryMethod}>
        <input type="hidden" name="id" value={id} />
        <div className="confirm-dialog__actions">
          <button className="button button--outline" type="button" autoFocus onClick={() => dialog.current?.close()}>Отмена</button>
          <ConfirmButton id={id} />
        </div>
      </form>
    </dialog>
  </>;
}
