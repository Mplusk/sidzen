import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Клиенты — управление", robots: { index: false, follow: false } };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  // Check authorization before retrieving any other user's personal data.
  await requirePermission(PERMISSIONS.customersRead);
  const params = await searchParams;
  const requested = typeof params.page === "string" ? Number(params.page) : 1;
  const total = await prisma.user.count();
  const pages = Math.max(1, Math.ceil(total / 50));
  const page = Number.isFinite(requested) ? Math.min(pages, Math.max(1, Math.floor(requested))) : 1;
  const clients = await prisma.user.findMany({
    select: { id: true, name: true, phone: true, email: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50,
  });
  return <>
    <div className="admin-header"><div><h1>Клиенты</h1><p className="muted">Все зарегистрированные пользователи, включая вход через социальные сети. Новые — в начале списка.</p></div></div>
    <p>Всего: {total}. Страница {page} из {pages}.</p>
    {!clients.length ? <p className="notice">Зарегистрированных пользователей пока нет.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th scope="col">ФИО</th><th scope="col">Телефон</th><th scope="col">Email</th><th scope="col">Регистрация</th></tr></thead><tbody>{clients.map(client => <tr key={client.id}>
      <td>{client.name?.trim() || <span className="muted">Не указано</span>}</td>
      <td>{client.phone?.trim() ? <a href={`tel:${client.phone.replace(/[^+\d]/g, "")}`}>{client.phone}</a> : <span className="muted">Не указан</span>}</td>
      <td><a href={`mailto:${client.email}`}>{client.email}</a></td>
      <td>{formatDate(client.createdAt)}</td>
    </tr>)}</tbody></table></div>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы списка клиентов">{page > 1 && <Link href={`/account/clients/?page=${page - 1}`} aria-label="Предыдущая страница">←</Link>}<span className="active" aria-current="page">{page}</span>{page < pages && <Link href={`/account/clients/?page=${page + 1}`} aria-label="Следующая страница">→</Link>}</nav>}
    <p className="muted">ФИО и телефон отображаются из профиля. Если пользователь их не заполнил, они не подставляются из чужих заказов. Доступ к списку имеют только сотрудники с правом просмотра клиентов.</p>
  </>;
}
