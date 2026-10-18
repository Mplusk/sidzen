import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { monitoringCutoff, monitoringDay } from "@/lib/monitoring-policy";
import { ClearMonitoring } from "@/components/clear-monitoring";
export const dynamic = "force-dynamic";
export const metadata = { title: "Мониторинг просмотров" };
const number = (value: bigint | number) => new Intl.NumberFormat("ru-RU").format(value);
const productSlug = (path: string) => path.match(/^\/catalog\/[^/]+\/([^/]+)\/$/)?.[1];
const date = (value: Date) => value.toLocaleDateString("ru-RU", { timeZone: "UTC", dateStyle: "medium" });

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ page?: string; days?: string; result?: string }> }) {
  const user = await requirePermission("monitoring.read", "/account/monitoring/");
  const params = await searchParams, days = [1, 7, 30].includes(Number(params.days)) ? Number(params.days) : 30;
  const now = new Date(), where = { day: { gte: monitoringCutoff(days, now), lte: monitoringDay(now) } };
  const [rows, daily] = await prisma.$transaction([
    prisma.monitoringCounter.groupBy({ by: ["path"], where, _sum: { views: true }, orderBy: [{ _sum: { views: "desc" } }, { path: "asc" }] }),
    prisma.monitoringCounter.groupBy({ by: ["day"], where, _sum: { views: true }, orderBy: { day: "desc" } }),
  ], { isolationLevel: "RepeatableRead" });
  const pages = Math.max(1, Math.ceil(rows.length / 40)), parsed = Number(params.page);
  const page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(pages, parsed) : 1;
  const selected = rows.slice((page - 1) * 40, page * 40);
  const products = await prisma.product.findMany({ where: { slug: { in: selected.flatMap(row => productSlug(row.path) ? [productSlug(row.path)!] : []) } }, select: { slug: true, name: true } });
  const names = new Map(products.map(product => [product.slug, product.name]));
  const total = rows.reduce((sum, row) => sum + (row._sum?.views ?? 0n), 0n);
  const productViews = rows.filter(row => productSlug(row.path)).reduce((sum, row) => sum + (row._sum?.views ?? 0n), 0n);
  const url = (target: number) => `/account/monitoring/?days=${days}&page=${target}`;
  return <>
    <div className="monitoring-heading"><div><h1>Мониторинг</h1><p className="muted">Общие просмотры страниц и товаров. Без отслеживания посетителей.</p></div>{(user.permissions.has("monitoring.clear") || user.roles.includes("superadmin")) && <ClearMonitoring />}</div>
    {params.result === "cleared" && <p className="notice notice--success" role="status">Счётчики очищены. Заказы и клиенты не изменены.</p>}
    {params.result && params.result !== "cleared" && <p className="notice" role="alert">Очистка не выполнена. Подтвердите действие или попробуйте позже.</p>}
    <form className="monitoring-filters" method="get"><label className="field"><span>Период</span><select name="days" defaultValue={days}><option value="1">Сегодня</option><option value="7">7 календарных дней</option><option value="30">30 календарных дней</option></select></label><button className="button" type="submit">Показать</button></form>
    <dl className="monitoring-totals" aria-label="Итоги выбранного периода"><div><dt>Все просмотры</dt><dd>{number(total)}</dd></div><div><dt>Из них карточки товаров</dt><dd>{number(productViews)}</dd></div><div><dt>Разных публичных страниц</dt><dd>{number(rows.length)}</dd></div></dl>
    <p className="muted">Повторное открытие увеличивает счётчик. Это не число людей или визитов. Хранятся только дата по Москве, публичная страница или товар и общее количество открытий за день. IP, источник, поиск, длительность, идентификаторы и связь с аккаунтом не записываются.</p>
    {!rows.length ? <div className="empty-state"><h2>Просмотров пока нет</h2><p>Счётчики появятся после открытия публичных страниц. Персональная история прежнего мониторинга не используется.</p></div> : <>
      <div className="table-scroll"><table className="monitoring-table monitoring-table--aggregate"><caption>Просмотры за выбранный период</caption><thead><tr><th scope="col">Страница</th><th scope="col">Тип</th><th scope="col">Просмотры</th></tr></thead><tbody>{selected.map(row => <tr key={row.path}><td><Link href={row.path}>{productSlug(row.path) ? names.get(productSlug(row.path)!) ?? row.path : row.path}</Link>{productSlug(row.path) && names.has(productSlug(row.path)!) && <small>{row.path}</small>}</td><td>{productSlug(row.path) ? "Карточка товара" : "Публичная страница"}</td><td>{number(row._sum?.views ?? 0n)}</td></tr>)}</tbody></table></div>
      {pages > 1 && <nav className="pagination" aria-label="Страницы счётчиков">{page > 1 && <Link href={url(page - 1)}>Назад</Link>}<span>Страница {page} из {pages}</span>{page < pages && <Link href={url(page + 1)}>Далее</Link>}</nav>}
      <details className="monitoring-daily"><summary>Общие просмотры по дням · МСК</summary><div className="table-scroll"><table className="monitoring-table monitoring-table--aggregate"><thead><tr><th scope="col">Дата</th><th scope="col">Просмотры</th></tr></thead><tbody>{daily.map(row => <tr key={row.day.toISOString()}><td>{date(row.day)}</td><td>{number(row._sum?.views ?? 0n)}</td></tr>)}</tbody></table></div></details>
    </>}
    <p className="muted">Счётчики хранятся за последние 30 календарных дней; очистка проверяется каждый час. Предзагрузка ссылок не считается открытием. При отключённом JavaScript, запрете отслеживания в браузере, блокировщике или сетевой ошибке просмотр может не учитываться. Защита от накруток не использует идентификацию посетителей.</p>
  </>;
}
