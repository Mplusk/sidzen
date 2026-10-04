import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/auth";

export const metadata: Metadata = { title: "Журнал аудита", robots: { index: false, follow: false } };

export default async function AuditPage() {
  await requirePermission("audit.read");
  const logs = await prisma.auditLog.findMany({ include: { actor: true }, orderBy: { createdAt: "desc" }, take: 500 });
  return <><div className="admin-header"><div><span className="eyebrow">Неизменяемая история</span><h1>Журнал аудита</h1></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Кто</th><th>Действие</th><th>Сущность</th><th>IP</th><th>Изменение</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.createdAt)}</td><td>{log.actor?.email ?? "Система"}</td><td><strong>{log.action}</strong></td><td>{log.entityType}<br /><small>{log.entityId}</small></td><td>{log.ip ?? "—"}</td><td><details><summary>Данные</summary><pre style={{ maxWidth: 420, overflow: "auto", fontSize: 11 }}>{JSON.stringify({ before: log.before, after: log.after }, null, 2)}</pre></details></td></tr>)}</tbody></table></div></>;
}
