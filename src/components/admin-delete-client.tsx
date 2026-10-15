"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { changeClientArchive, eraseClientPersonalData } from "@/app/actions/clients";

function ConfirmButton({ restore }: { restore: boolean }) {
  const { pending } = useFormStatus();
  const operation = restore ? "restore" : "archive";
  return <button className={`button ${restore ? "" : "button--danger"}`} type="submit" name="confirmation" value={operation} disabled={pending}>{pending ? "Сохраняем…" : restore ? "Да, восстановить" : "Да, архивировать"}</button>;
}

export function AdminDeleteClient({ clientKey, name, restore = false }: { clientKey: string; name: string; restore?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId(), description = useId();
  return <>
    <button type="button" className="admin-delete-link" aria-label={`${restore ? "Восстановить" : "Архивировать"} клиента ${name}`} onClick={() => dialog.current?.showModal()}>{restore ? "Восстановить" : "Архивировать"}</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>{restore ? "Восстановить" : "Архивировать"} клиента {name}?</h2>
      <p id={description}>{restore ? "Карточка вернётся в основной список клиентов." : "Карточка исчезнет из основного списка. Заказы, документы, контакты в заказах и аккаунт для входа останутся без изменений. Карточку можно восстановить в архиве. Это не удаление персональных данных."}</p>
      <form action={changeClientArchive}>
        <input type="hidden" name="clientKey" value={clientKey} />
        <input type="hidden" name="operation" value={restore ? "restore" : "archive"} />
        <div className="confirm-dialog__actions"><button type="button" className="button button--outline" autoFocus onClick={() => dialog.current?.close()}>Отмена</button><ConfirmButton restore={restore} /></div>
      </form>
    </dialog>
  </>;
}

function EraseButton() {
  const { pending } = useFormStatus();
  return <button className="button button--danger" name="confirmation" value="erase" disabled={pending}>{pending ? "Удаляем…" : "Необратимо удалить данные"}</button>;
}
export function AdminEraseClient({ clientKey, name }: { clientKey: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), title = useId(), description = useId();
  return <>
    <button type="button" className="admin-delete-link" aria-label={`Удалить персональные данные клиента ${name}`} onClick={() => { dialog.current?.showModal(); heading.current?.focus({ preventScroll: true }); }}>Удалить персональные данные</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title} ref={heading} tabIndex={-1}>Удалить данные клиента {name}?</h2>
      <p id={description}>Учётная запись, сессии, профиль, адреса, отзывы и фотографии будут удалены. Восстановления из архива нет. При активных обязательствах операция будет остановлена. Необходимые документы о состоявшихся расчётах сохранятся отдельно до окончания срока хранения; остальные контакты в заказах будут очищены.</p>
      <p className="muted">Резервные копии выбывают из ротации за 14 дней. Физическое удаление файлов проверяется в журнале удалений. Сохранение у перевозчика регулируется его основаниями обработки.</p>
      <form action={eraseClientPersonalData}>
        <input type="hidden" name="clientKey" value={clientKey} />
        <label className="checkout-consent"><input type="checkbox" name="verified" required /><span>Подтверждаю проверку принадлежности обращения и основания удаления. Понимаю исключения для обязательных документов.</span></label>
        <p className="muted">До удаления сохраните данные подтверждённого обращения для оформления акта. Журнал не хранит ФИО и контакты клиента.</p>
        <label className="field">Для подтверждения введите УДАЛИТЬ<input name="phrase" required pattern="УДАЛИТЬ" maxLength={7} autoComplete="off" /></label>
        <div className="confirm-dialog__actions"><button type="button" className="button button--outline" autoFocus onClick={() => dialog.current?.close()}>Отмена</button><EraseButton /></div>
      </form>
    </dialog>
  </>;
}
