import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import { assignRoleAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { RemoveUserRole } from "@/components/remove-user-role";

export const metadata: Metadata = { title: "Пользователи и роли", robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  invalid: "Не удалось определить пользователя или роль. Обновите страницу и попробуйте снова.",
  missing: "Эта роль уже снята или пользователь не найден. Обновите страницу.",
  forbidden: "У вас больше нет прав управлять пользователями.",
  "last-superadmin": "Нельзя снять роль у последнего активного суперадминистратора. Сначала назначьте другого.",
  "own-access": "Нельзя снять последнюю роль, дающую вам право управлять пользователями.",
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string; removed?: string }> }) {
  await requirePermission("users.write");
  const { error, removed } = await searchParams;
  const [users, roles] = await Promise.all([prisma.user.findMany({ include: { roles: { include: { role: true } }, orders: { select: { id: true } } }, orderBy: { createdAt: "desc" }, take: 300 }), prisma.role.findMany({ orderBy: { name: "asc" } })]);
  return <>
    <div className="admin-header"><div><h1>Пользователи и роли</h1></div></div>
    {error && <p className="notice notice--danger" role="alert">{errors[error] ?? "Не удалось снять роль. Обновите страницу и попробуйте снова."}</p>}
    {removed === "1" && <p className="notice" role="status">Роль снята.</p>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Пользователь</th><th>Создан</th><th>Заказы</th><th>Роли</th><th>Назначить</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
      <td><strong>{user.name ?? "Без имени"}</strong><br /><small>{user.email}</small></td>
      <td>{formatDate(user.createdAt)}</td><td>{user.orders.length}</td>
      <td><div className="user-role-list">{user.roles.length ? user.roles.map(({ role }) => <div className="user-role-item" key={role.id}><span>{role.name}</span><RemoveUserRole userId={user.id} userName={user.email} roleId={role.id} roleName={role.name} /></div>) : "—"}</div></td>
      <td><form action={assignRoleAction} className="user-role-assign"><input type="hidden" name="userId" value={user.id} /><select name="roleId" aria-label={`Назначить роль пользователю ${user.email}`}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select><SubmitButton className="button button--small" pendingLabel="Сохраняем…">Назначить</SubmitButton></form></td>
    </tr>)}</tbody></table></div>
  </>;
}

