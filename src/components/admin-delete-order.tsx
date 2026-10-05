"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { deleteOrderAction } from "@/app/actions/admin-orders";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button className="button button--danger" type="submit" disabled={pending}>{pending ? "Удаление…" : "Да, удалить заказ"}</button>;
}

export function AdminDeleteOrder({ id, number }: { id: string; number: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return <>
    <button type="button" className="admin-delete-link" onClick={() => dialog.current?.showModal()} aria-label={`Удалить заказ ${number}`}>Удалить заказ</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}>
      <h2 id={titleId}>Удалить заказ {number}?</h2>
      <p id={descriptionId}>Заказ исчезнет из кабинета клиента и списка заказов вместе с данными об оплате и доставке. Восстановить его через сайт нельзя. Удаление не возвращает оплату покупателю. Заказы с обязательной историей кассовых чеков удалить нельзя.</p>
      <form action={deleteOrderAction}>
        <input type="hidden" name="orderId" value={id} />
        <input type="hidden" name="confirmation" value={number} />
        <div className="confirm-dialog__actions">
          <button className="button button--outline" type="button" autoFocus onClick={() => dialog.current?.close()}>Отмена</button>
          <ConfirmButton />
        </div>
      </form>
    </dialog>
  </>;
}
