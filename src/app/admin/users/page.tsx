import type { Metadata } from "next";
import { assignRoleAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export const metadata: Metadata = { title: "Пользователи и роли", robots: { index: false, follow: false } };

export default async function UsersPage() {
  await requirePermission("users.write");
  const [users, roles] = await Promise.all([prisma.user.findMany({ include: { roles: { include: { role: true } }, orders: { select: { id: true } } }, orderBy: { createdAt: "desc" }, take: 300 }), prisma.role.findMany({ orderBy: { name: "asc" } })]);
  return <><div className="admin-header"><div><span className="eyebrow">RBAC</span><h1>Пользователи и роли</h1></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Пользователь</th><th>Создан</th><th>Заказы</th><th>Роли</th><th>Назначить</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name ?? "Без имени"}</strong><br /><small>{user.email}</small></td><td>{formatDate(user.createdAt)}</td><td>{user.orders.length}</td><td>{user.roles.map((item) => item.role.name).join(", ") || "—"}</td><td><form action={assignRoleAction} style={{ display: "flex", gap: 8 }}><input type="hidden" name="userId" value={user.id} /><select name="roleId">{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select><button className="button button--small" type="submit">Назначить</button></form></td></tr>)}</tbody></table></div></>;
}
