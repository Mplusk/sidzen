import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClearMonitoring } from "@/components/clear-monitoring";

export const dynamic = "force-dynamic";
export const metadata = { title: "Мониторинг посещений" };
const date = (value: Date) => value.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });
const duration = (seconds: number) => seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
const cutoff = (days: number) => new Date(Date.now() - days * 86400000);
function countryName(code: string | null) { try { return code ? new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code : "Не определена"; } catch { return code ?? "Не определена"; } }

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ page?: string; ip?: string; country?: string; days?: string; result?: string }> }) {
  const user = await requirePermission("monitoring.read", "/account/monitoring/");
  const params = await searchParams, days = [1, 7, 30].includes(Number(params.days)) ? Number(params.days) : 30;
  const ip = (params.ip ?? "").trim().slice(0, 45), country = /^[A-Z]{2}$/.test(params.country ?? "") ? params.country : undefined;
  const where: Prisma.MonitoringVisitWhereInput = { createdAt: { gte: cutoff(days) }, ...(ip ? { ip } : {}), ...(country ? { country } : {}) };
  const count = await prisma.monitoringVisit.count({ where }), pages = Math.max(1, Math.ceil(count / 40));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.page) || 1)));
  const [visits, visitors, views, active, countries] = await Promise.all([
    prisma.monitoringVisit.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 40, skip: (page - 1) * 40, include: { user: { select: { name: true } }, pages: { orderBy: { createdAt: "asc" }, take: 200 } } }),
    prisma.monitoringVisit.groupBy({ by: ["visitorHash"], where, _count: { _all: true } }),
    prisma.monitoringPage.count({ where: { visit: where } }),
    prisma.monitoringPage.aggregate({ where: { visit: where }, _sum: { activeSeconds: true } }),
    prisma.monitoringVisit.groupBy({ by: ["country"], where: { country: { not: null }, createdAt: { gte: cutoff(30) } }, orderBy: { country: "asc" } }),
  ]);
  const frequencies = new Map(visitors.map(visitor => [visitor.visitorHash, visitor._count._all]));
  const url = (value: number) => { const query = new URLSearchParams({ page: String(value), days: String(days) }); if (ip) query.set("ip", ip); if (country) query.set("country", country); return "/account/monitoring/?" + query; };
  return <><div className="monitoring-heading"><div><h1>Мониторинг</h1><p className="muted">Посещения с согласия на статистику. Новые визиты — в начале списка.</p></div>{(user.permissions.has("monitoring.clear") || user.roles.includes("superadmin")) && <ClearMonitoring />}</div>
    {params.result === "cleared" && <p className="notice notice--success" role="status">Мониторинг очищен. Заказы и клиенты не изменены.</p>}
    {params.result && params.result !== "cleared" && <p className="notice" role="alert">Очистка не выполнена. Подтвердите действие или попробуйте позже.</p>}
    <div className="monitoring-summary" aria-label="Итоги выбранного периода"><div><strong>{visitors.length}</strong><span>Браузеров</span></div><div><strong>{count}</strong><span>Визитов</span></div><div><strong>{views}</strong><span>Просмотров</span></div><div><strong>{duration(active._sum.activeSeconds ?? 0)}</strong><span>Активное время</span></div></div>
    <form className="monitoring-filters" method="get"><label>Период<select name="days" defaultValue={days}><option value="1">Сутки</option><option value="7">7 дней</option><option value="30">30 дней</option></select></label><label>IP<input name="ip" maxLength={45} defaultValue={ip} placeholder="Точный IP" /></label><label>Страна<select name="country" defaultValue={country ?? ""}><option value="">Все страны</option>{countries.map(item => <option key={item.country} value={item.country!}>{countryName(item.country)}</option>)}</select></label><button className="button" type="submit">Показать</button><Link className="text-link" href="/account/monitoring/">Сбросить</Link></form>
    <p className="muted">Автоочистка: записи старше 30 дней удаляются каждый час. IP определяет страну приблизительно, VPN меняет результат. Один браузер не равен одному человеку. Частота — число визитов в выбранном периоде; новый визит после 30 минут бездействия. Администраторы и распознанные боты не учитываются.</p>
    <p className="muted">Источник и поисковая фраза доступны, только если браузер их передал. Отсутствующий источник не обязательно означает прямой заход. Время — оценка активности на видимой странице, без длительного простоя; закрытые страницы кабинета и формы не записываются.</p>
    {!visits.length ? <div className="empty-state"><h2>Визитов пока нет</h2><p>Они появятся, когда посетители разрешат статистику и откроют каталог или другую публичную страницу. Старые посещения восстановить нельзя.</p></div> : <div className="table-scroll"><table className="monitoring-table"><thead><tr><th>Начало · МСК</th><th>Посетитель / IP</th><th>Страна / устройство</th><th>Источник</th><th>Активность</th></tr></thead><tbody>{visits.map(visit => <tr key={visit.id}>
      <td>{date(visit.createdAt)}<small>Последний сигнал: {date(visit.lastSeenAt)}</small></td>
      <td><strong>{visit.user?.name ?? "Гость"}</strong><small>Браузер {visit.visitorHash.slice(0, 8)}</small><code>{visit.ip ?? "IP недоступен"}</code><small>{frequencies.get(visit.visitorHash) ?? 1} визит(ов) за {days} дн.</small></td>
      <td>{countryName(visit.country)}<small>{visit.device} · {visit.browser}</small></td>
      <td>{visit.source ?? "Не передан"}{visit.searchPhrase && <small>Фраза: {visit.searchPhrase}</small>}{visit.campaign && <small>Кампания: {visit.campaign}</small>}</td>
      <td><strong>{visit.pages.length} страниц · {duration(visit.pages.reduce((sum, item) => sum + item.activeSeconds, 0))}</strong><details><summary>Просмотренные страницы</summary><ol>{visit.pages.map(item => <li key={item.id}><Link href={item.path}>{item.path}</Link>{item.search && <small>Поиск в магазине: {item.search}</small>}<small>{date(item.createdAt)} · {duration(item.activeSeconds)}</small></li>)}</ol></details></td>
    </tr>)}</tbody></table></div>}
    <nav className="pagination" aria-label="Страницы мониторинга">{page > 1 && <Link href={url(page - 1)}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={url(page + 1)}>Далее</Link>}</nav>
  </>;
}
