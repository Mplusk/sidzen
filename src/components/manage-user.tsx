"use client";

import { useId, useRef, useState } from "react";
import { manageUserAction } from "@/app/actions/users";
import { SubmitButton } from "@/components/submit-button";

export function ManageUser({ userId, email, archived, canErase }: { userId: string; email: string; archived: boolean; canErase: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(), description = useId();
  const [operation, setOperation] = useState<"archive" | "restore" | "erase">(archived ? "restore" : "archive");
  return <>
    <button className="admin-delete-link" type="button" aria-label={`Управление пользователем ${email}`} onClick={() => { setOperation(archived ? "restore" : "archive"); dialog.current?.showModal(); }}>{archived ? "Управлять" : "Удалить"}</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>Пользователь {email}</h2>
      <p id={description}>Выберите действие для учётной записи.</p>
      <form action={manageUserAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="view" value={archived ? "archived" : "active"} />
        <fieldset className="user-management-options"><legend>Действие</legend>
          <label><input type="radio" name="operation" value={archived ? "restore" : "archive"} checked={operation !== "erase"} onChange={() => setOperation(archived ? "restore" : "archive")} /> {archived ? "Восстановить аккаунт" : "Переместить в архив"}</label>
          {canErase && <label><input type="radio" name="operation" value="erase" checked={operation === "erase"} onChange={() => setOperation("erase")} /> Удалить навсегда</label>}
        </fieldset>
        {operation === "erase" ? <>
          <p>Аккаунт, сессии, профиль, отзывы и фотографии будут удалены без возможности восстановления. Незавершённые заказы и другие обязательства остановят удаление. Необходимые документы о расчётах сохранятся отдельно; остальные связанные данные заказов будут очищены.</p>
          <p className="muted">Резервные копии выбывают из ротации за 14 дней. Физическое удаление файлов проверяется в журнале удалений. Данные перевозчиков обрабатываются ими отдельно.</p>
          <label className="checkout-consent"><input type="checkbox" name="verified" required /><span>Подтверждаю основание удаления и понимаю исключения для обязательных документов.</span></label>
          <label className="field">Введите УДАЛИТЬ для подтверждения<input name="phrase" required pattern="УДАЛИТЬ" maxLength={7} autoComplete="off" /></label>
        </> : <p>{archived ? "Аккаунт снова сможет войти с прежним паролем и ролями. Прежние сеансы не восстанавливаются." : "Вход будет заблокирован, текущие сеансы завершатся. Роли, заказы и данные сохранятся; аккаунт можно восстановить из архива. Покупательские аккаунты могут очищаться после 24 месяцев без входа и изменений, если нет активных обязательств."}</p>}
        {!canErase && <p className="muted">Для необратимого удаления нужны права управления пользователями, клиентами и заказами.</p>}
        <div className="confirm-dialog__actions"><button className="button button--outline" type="button" autoFocus onClick={() => dialog.current?.close()}>Отмена</button><SubmitButton className={`button ${operation === "restore" ? "" : "button--danger"}`} name="confirmation" value={operation} pendingLabel="Выполняем…">{operation === "erase" ? "Удалить навсегда" : operation === "restore" ? "Восстановить" : "В архив"}</SubmitButton></div>
      </form>
    </dialog>
  </>;
}

