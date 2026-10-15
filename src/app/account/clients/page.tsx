import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { getClientsPage } from "@/lib/clients";
import { formatDate } from "@/lib/format";
import { AdminDeleteClient, AdminEraseClient } from "@/components/admin-delete-client";

export const metadata: Metadata = { title: "Клиенты — управление", robots: { index: false, follow: false } };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; view?: string; result?: string }> }) {
  // Check authorization before retrieving any other user's personal data.
  const user = await requirePermission(PERMISSIONS.customersRead);
  const params = await searchParams;
  const requested = typeof params.page === "string" ? Number(params.page) : 1;
  const archived = params.view === "deleted";
  const canDelete = user.roles.includes("superadmin") || user.permissions.has(PERMISSIONS.customersWrite);
  const canErase = user.roles.includes("superadmin") || [PERMISSIONS.customersWrite, PERMISSIONS.usersWrite, PERMISSIONS.ordersWrite].every(permission => user.permissions.has(permission));
  const { clients, total, pages, page } = await getClientsPage(requested, archived);
  const pageLink = (target: number) => `/account/clients/?page=${target}${archived ? "&view=deleted" : ""}`;
  const messages: Record<string, string> = { deleted: "Карточка архивирована. Это не удаление персональных данных.", restored: "Клиент восстановлен.", confirmation: "Действие не подтверждено. Проверьте отметку и слово УДАЛИТЬ.", missing: "Карточка больше не найдена. Обновите список.", rate: "Слишком много действий. Повторите через минуту.", erased: "Данные удалены из рабочей базы. Результат удаления файлов и резервных копий — в журнале удалений.", "erased-retained": "Учётная запись и необязательные данные удалены. Необходимые документы о расчётах сохранены отдельно до окончания срока. Срок и результат удаления файлов — в журнале.", "erasure-active": "Удаление остановлено: есть активный заказ, спор, незавершённая отмена доставки или расчёт. Сначала завершите обязательства.", "erasure-protected": "Нельзя удалить собственную учётную запись или аккаунт сотрудника из списка клиентов.", "erasure-files-in-use": "Удаление остановлено: загруженный файл используется в другом заказе. Сначала проверьте связанные обязательства.", "erasure-missing": "Клиент уже отсутствует. Обновите список.", "erasure-storage": "Размещение данных и резервных копий в России не подтверждено.", "erasure-failed": "Операцию не удалось завершить. Не подтверждайте уничтожение: проверьте журнал и повторите после устранения причины." };
  return <>
    <div className="admin-header"><div><h1>{archived ? "Архив клиентов" : "Клиенты"}</h1><p className="muted">Зарегистрированные пользователи и покупатели, оформившие заказ без регистрации. Карточка покупателя появляется автоматически после заказа.</p></div></div>
    <div className="confirm-dialog__actions"><Link className="button button--outline button--small" href="/account/clients/">Все клиенты</Link><Link className="button button--outline button--small" href="/account/clients/?view=deleted">Архив</Link>{canErase && <Link className="text-link" href="/admin/privacy/#erasures">Журнал удалений</Link>}</div>
    {params.result && messages[params.result] && <p className={`notice ${["deleted", "restored", "erased", "erased-retained"].includes(params.result) ? "notice--success" : "notice--danger"}`} role="status">{messages[params.result]}</p>}
    <p>Всего: {total}. Страница {page} из {pages}.</p>
{!clients.length ? <p className="notice">{archived ? "Архив пуст." : "Клиентов пока нет."}</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th scope="col">ФИО</th><th scope="col">Телефон</th><th scope="col">Email</th><th scope="col">Тип</th><th scope="col">Добавлен</th>{canDelete && <th scope="col">Действия</th>}</tr></thead><tbody>{clients.map(client => <tr key={client.id}>
      <td>{client.name?.trim() || <span className="muted">Не указано</span>}</td>
      <td>{client.phone?.trim() ? <a href={`tel:${client.phone.replace(/[^+\d]/g, "")}`}>{client.phone}</a> : <span className="muted">Не указан</span>}</td>
      <td><a href={`mailto:${client.email}`}>{client.email}</a></td>
      <td>{client.source === "ACCOUNT" ? "Аккаунт" : "Покупатель без регистрации"}</td>
      <td>{formatDate(client.createdAt)}</td>
      {canDelete && <td><div className="client-actions"><AdminDeleteClient clientKey={client.id} name={client.name?.trim() || client.email} restore={archived} />{canErase && <AdminEraseClient clientKey={client.id} name={client.name?.trim() || client.email} />}</div></td>}
    </tr>)}</tbody></table></div>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы списка клиентов">{page > 1 && <Link href={pageLink(page - 1)} aria-label="Предыдущая страница">←</Link>}<span className="active" aria-current="page">{page}</span>{page < pages && <Link href={pageLink(page + 1)} aria-label="Следующая страница">→</Link>}</nav>}
    <p className="muted">Повторные заказы с одинаковыми email и телефоном объединяются в одну карточку. Для аккаунта недостающие ФИО и телефон берутся только из его собственных заказов. Карточка без регистрации не даёт доступ ко входу или заказам. Доступ к списку имеют только сотрудники с правом просмотра клиентов.</p>
  </>;
}
