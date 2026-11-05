import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import Link from "next/link";
import { assignRoleAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { RemoveUserRole } from "@/components/remove-user-role";
import { ManageUser } from "@/components/manage-user";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Пользователи и роли", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  invalid: "Не удалось определить пользователя или роль. Обновите страницу и попробуйте снова.",
  missing: "Эта роль уже снята или пользователь не найден. Обновите страницу.",
  forbidden: "У вас больше нет прав управлять пользователями.",
  "last-superadmin": "Нельзя снять роль у последнего активного суперадминистратора. Сначала назначьте другого.",
  "own-access": "Нельзя снять последнюю роль, дающую вам право управлять пользователями.",
};
const results: Record<string, string> = {
  archived: "Аккаунт перемещён в архив, вход заблокирован.", restored: "Аккаунт восстановлен; пользователь может войти снова.",
  erased: "Аккаунт и связанные данные удалены. Проверьте статус удаления файлов в журнале.",
  "erased-retained": "Аккаунт удалён. Необходимые документы о расчётах сохранены отдельно; статус файлов — в журнале.",
  confirmation: "Действие не подтверждено. Проверьте выбранный вариант и подтверждение удаления.",
  rate: "Слишком много действий. Повторите через минуту.", missing: "Пользователь не найден. Обновите список.",
  forbidden: "У вас больше нет прав управлять пользователями.", self: "Нельзя архивировать собственный аккаунт.",
  "last-superadmin": "Нельзя архивировать последнего активного суперадминистратора. Сначала назначьте другого.",
  "erasure-protected": "Нельзя удалить собственный аккаунт.", "erasure-last-superadmin": "Нельзя удалить последнего активного суперадминистратора. Сначала назначьте другого.",
  "erasure-active": "Удаление остановлено: есть активный заказ, спор, доставка или расчёт. Сначала завершите обязательства.",
  "erasure-files-in-use": "Удаление остановлено: файл используется в другом заказе. Проверьте связанные обязательства.",
  "erasure-missing": "Пользователь уже удалён. Обновите список.", "erasure-forbidden": "Для удаления необходимы права управления пользователями, клиентами и заказами.",
  "erasure-storage": "Удаление недоступно: размещение данных и резервных копий в России не подтверждено.",
  "erasure-failed": "Не удалось завершить удаление. Проверьте журнал удалений и повторите после устранения причины.",
};

const visitDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; removed?: string; result?: string; view?: string }> }) {
  const actor = await requirePermission("users.write");
  const { error, removed, result, view } = await searchParams;
  const archived = view === "archived";
  const canErase = actor.roles.includes("superadmin") || [PERMISSIONS.customersRead, PERMISSIONS.customersWrite, PERMISSIONS.ordersWrite].every(permission => actor.permissions.has(permission));
  const [users, roles] = await Promise.all([prisma.user.findMany({ where: { isActive: !archived }, include: { roles: { include: { role: true } }, orders: { select: { id: true } } }, orderBy: { createdAt: "desc" }, take: 300 }), prisma.role.findMany({ orderBy: { name: "asc" } })]);
  return <>
    <div className="admin-header"><div><h1>{archived ? "Архив пользователей" : "Пользователи и роли"}</h1></div></div>
    <nav className="user-list-nav" aria-label="Список пользователей"><Link className="button button--outline button--small" href="/admin/users/" aria-current={!archived ? "page" : undefined}>Пользователи</Link><Link className="button button--outline button--small" href="/admin/users/?view=archived" aria-current={archived ? "page" : undefined}>Архив</Link></nav>
    <p className="muted">Последний известный визит под учётной записью, время московское. Активность обновляется не чаще раза в час; прежние визиты показаны по сохранившимся сеансам.</p>
    {error && <p className="notice notice--danger" role="alert">{errors[error] ?? "Не удалось снять роль. Обновите страницу и попробуйте снова."}</p>}
    {removed === "1" && <p className="notice" role="status">Роль снята.</p>}
    {result && <p className={`notice ${["archived", "restored", "erased", "erased-retained"].includes(result) ? "notice--success" : "notice--danger"}`} role="status">{results[result] ?? "Не удалось выполнить действие. Обновите страницу и повторите."}</p>}
    {!users.length ? <p className="notice">{archived ? "Архив пуст." : "Пользователей нет."}</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Пользователь</th><th>Создан</th><th>Последний визит</th><th>Заказы</th><th>Роли</th><th>Назначить</th><th>Действия</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
      <td><strong>{user.name ?? "Без имени"}</strong><br /><small>{user.email}</small></td>
      <td>{formatDate(user.createdAt)}</td><td>{user.lastVisitedAt ? <time dateTime={user.lastVisitedAt.toISOString()}>{visitDate.format(user.lastVisitedAt)}</time> : "Нет данных"}</td><td>{user.orders.length}</td>
      <td><div className="user-role-list">{user.roles.length ? user.roles.map(({ role }) => <div className="user-role-item" key={role.id}><span>{role.name}</span>{!archived && <RemoveUserRole userId={user.id} userName={user.email} roleId={role.id} roleName={role.name} />}</div>) : "—"}</div></td>
      <td>{archived ? <span className="muted">После восстановления</span> : <form action={assignRoleAction} className="user-role-assign"><input type="hidden" name="userId" value={user.id} /><select name="roleId" aria-label={`Назначить роль пользователю ${user.email}`}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select><SubmitButton className="button button--small" pendingLabel="Сохраняем…">Назначить</SubmitButton></form>}</td>
      <td><ManageUser userId={user.id} email={user.email} archived={archived} canErase={canErase} /></td>
    </tr>)}</tbody></table></div>}
  </>;
}
