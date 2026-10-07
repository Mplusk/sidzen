import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { getClientsPage } from "@/lib/clients";
import { formatDate } from "@/lib/format";
import { AdminDeleteClient } from "@/components/admin-delete-client";

export const metadata: Metadata = { title: "Клиенты — управление", robots: { index: false, follow: false } };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; view?: string; result?: string }> }) {
  // Check authorization before retrieving any other user's personal data.
  const user = await requirePermission(PERMISSIONS.customersRead);
  const params = await searchParams;
  const requested = typeof params.page === "string" ? Number(params.page) : 1;
  const archived = params.view === "deleted";
  const canDelete = user.roles.includes("superadmin") || user.permissions.has(PERMISSIONS.customersWrite);
  const { clients, total, pages, page } = await getClientsPage(requested, archived);
  const pageLink = (target: number) => `/account/clients/?page=${target}${archived ? "&view=deleted" : ""}`;
  const messages: Record<string, string> = { deleted: "Клиент удалён из рабочего списка. Заказы и аккаунт сохранены. Восстановление — в «Удалённых».", restored: "Клиент восстановлен.", confirmation: "Действие не подтверждено. Откройте окно подтверждения.", missing: "Карточка больше не найдена. Обновите список.", rate: "Слишком много действий. Повторите через минуту." };
  return <>
    <div className="admin-header"><div><h1>{archived ? "Удалённые клиенты" : "Клиенты"}</h1><p className="muted">Зарегистрированные пользователи и покупатели, оформившие заказ без регистрации. Карточка покупателя появляется автоматически после заказа.</p></div></div>
    <div className="confirm-dialog__actions"><Link className="button button--outline button--small" href="/account/clients/">Все клиенты</Link><Link className="button button--outline button--small" href="/account/clients/?view=deleted">Удалённые</Link></div>
    {params.result && messages[params.result] && <p className={`notice ${["deleted", "restored"].includes(params.result) ? "notice--success" : "notice--danger"}`} role="status">{messages[params.result]}</p>}
    <p>Всего: {total}. Страница {page} из {pages}.</p>
    {!clients.length ? <p className="notice">{archived ? "Удалённых клиентов нет." : "Клиентов пока нет."}</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th scope="col">ФИО</th><th scope="col">Телефон</th><th scope="col">Email</th><th scope="col">Тип</th><th scope="col">Добавлен</th>{canDelete && <th scope="col">Действия</th>}</tr></thead><tbody>{clients.map(client => <tr key={client.id}>
      <td>{client.name?.trim() || <span className="muted">Не указано</span>}</td>
      <td>{client.phone?.trim() ? <a href={`tel:${client.phone.replace(/[^+\d]/g, "")}`}>{client.phone}</a> : <span className="muted">Не указан</span>}</td>
      <td><a href={`mailto:${client.email}`}>{client.email}</a></td>
      <td>{client.source === "ACCOUNT" ? "Аккаунт" : "Покупатель без регистрации"}</td>
      <td>{formatDate(client.createdAt)}</td>
      {canDelete && <td><AdminDeleteClient clientKey={client.id} name={client.name?.trim() || client.email} restore={archived} /></td>}
    </tr>)}</tbody></table></div>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы списка клиентов">{page > 1 && <Link href={pageLink(page - 1)} aria-label="Предыдущая страница">←</Link>}<span className="active" aria-current="page">{page}</span>{page < pages && <Link href={pageLink(page + 1)} aria-label="Следующая страница">→</Link>}</nav>}
    <p className="muted">Повторные заказы с одинаковыми email и телефоном объединяются в одну карточку. Для аккаунта недостающие ФИО и телефон берутся только из его собственных заказов. Карточка без регистрации не даёт доступ ко входу или заказам. Доступ к списку имеют только сотрудники с правом просмотра клиентов.</p>
  </>;
}
