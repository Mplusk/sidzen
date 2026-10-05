import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { diagnosticEvents, logAreas, logLevels, safeDiagnosticDetails, type DiagnosticCode, type DiagnosticDetails } from "@/lib/diagnostic-events";
import { ClearDiagnosticLogs } from "@/components/clear-diagnostic-logs";

export const metadata: Metadata = { title: "Логи — журнал событий", robots: { index: false, follow: false } };
type Query = Record<string, string | string[] | undefined>;
const single = (value: Query[string]) => typeof value === "string" ? value : "";
const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Moscow" });
export default async function LogsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requirePermission("settings.write");
  const query = await searchParams;
  const area = single(query.area), level = single(query.level), reference = single(query.reference).trim();
  const requestedPage = Math.min(200, Math.max(1, Number(single(query.page)) || 1));
  const where: Prisma.DiagnosticLogWhereInput = {
    ...(Object.hasOwn(logAreas, area) ? { area } : {}), ...(Object.hasOwn(logLevels, level) ? { level } : {}),
    ...(reference ? { reference: /^[a-f0-9-]{36}$/i.test(reference) ? reference.toLowerCase() : "invalid" } : {}),
  };
  const total = await prisma.diagnosticLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / 50)), page = Math.min(pages, Math.floor(requestedPage));
  const rows = await prisma.diagnosticLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50 });
  const result = single(query.result);
  function pageLink(target: number) { const params = new URLSearchParams({ page: String(target) }); if (Object.hasOwn(logAreas, area)) params.set("area", area); if (Object.hasOwn(logLevels, level)) params.set("level", level); if (reference) params.set("reference", reference); return `/account/logs/?${params}`; }
  return <>
    <div className="admin-header"><div><h1>Логи</h1><p className="muted">Ошибки и события сайта. Время московское. Храним до 30 дней и не более 10 000 записей.</p></div><ClearDiagnosticLogs /></div>
    {result && <p className={`notice ${result === "cleared" ? "notice--success" : "notice--danger"}`} role="status">{result === "cleared" ? "Все диагностические логи удалены. Новые события продолжат записываться." : result === "rate" ? "Слишком много удалений. Повторите через минуту." : "Подтвердите удаление в открывшемся окне."}</p>}
    <form method="get" className="form-grid content-card">
      <label className="field">Раздел<select name="area" defaultValue={area}><option value="">Все разделы</option>{Object.entries(logAreas).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="field">Уровень<select name="level" defaultValue={level}><option value="">Все уровни</option>{Object.entries(logLevels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="field field--full">Код обращения<input name="reference" defaultValue={reference} maxLength={36} placeholder="Код из сообщения об ошибке" /></label>
      <button className="button button--small" type="submit">Показать</button><Link className="button button--outline" href="/account/logs/">Сбросить фильтры / обновить</Link>
    </form>
    <p>Найдено записей: {total}. Страница {page} из {pages}.</p>
    {!rows.length ? <p className="notice">Записей пока нет или они не подходят под выбранные фильтры. События записываются с момента подключения журнала; прошлые ошибки восстановить нельзя.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата · МСК</th><th>Раздел</th><th>Уровень</th><th>Событие</th></tr></thead><tbody>{rows.map(row => {
      const event = diagnosticEvents[row.code as DiagnosticCode];
      const details = safeDiagnosticDetails((row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {}) as DiagnosticDetails);
      return <tr key={row.id}><td style={{ whiteSpace: "nowrap" }}>{dateFormat.format(row.createdAt)}</td><td>{logAreas[row.area as keyof typeof logAreas] ?? "Система"}</td><td>{logLevels[row.level as keyof typeof logLevels] ?? "Событие"}</td><td><strong>{event?.[2] ?? "Системное событие"}</strong><br /><small>Код обращения: {row.reference}</small>{Object.keys(details).length > 0 && <details><summary>Технические сведения</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>}</td></tr>;
    })}</tbody></table></div>}
    <nav className="pagination" aria-label="Страницы журнала">{page > 1 && <Link href={pageLink(page - 1)} aria-label="Предыдущая страница">←</Link>}<span className="active">{page}</span>{page < pages && <Link href={pageLink(page + 1)} aria-label="Следующая страница">→</Link>}</nav>
    <p className="muted">В журнал не записываются имена, телефоны, адреса, email, пароли, ключи API, токены и содержимое ответов сервисов. Удаление относится только к этому журналу, не к журналу аудита и финансовым документам.</p>
  </>;
}
