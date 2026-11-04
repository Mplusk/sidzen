"use client";

import { useId, useRef } from "react";
import { removeRoleAction } from "@/app/actions/admin";
import { SubmitButton } from "@/components/submit-button";

export function RemoveUserRole({ userId, userName, roleId, roleName }: { userId: string; userName: string; roleId: string; roleName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  return <>
    <button type="button" className="admin-delete-link" aria-label={`Снять роль «${roleName}» у ${userName}`} onClick={() => dialog.current?.showModal()}>Снять</button>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>Снять роль «{roleName}»?</h2>
      <p id={description}>Пользователь {userName} потеряет права, которые даёт эта роль. Остальные роли сохранятся.</p>
      <form action={removeRoleAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="roleId" value={roleId} />
        <div className="confirm-dialog__actions">
          <button className="button button--outline" type="button" autoFocus onClick={() => dialog.current?.close()}>Отмена</button>
          <SubmitButton className="button button--danger" pendingLabel="Снимаем…">Снять роль</SubmitButton>
        </div>
      </form>
    </dialog>
  </>;
}

