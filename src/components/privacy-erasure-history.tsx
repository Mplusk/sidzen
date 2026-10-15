import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { erasurePlanSchema } from "@/lib/privacy-erasure";
import { formatDate } from "@/lib/format";
export async function PrivacyErasureHistory({ requestedPage }: { requestedPage?: string }) {
  await requirePermission("users.write");
  const total = await prisma.privacyErasure.count(), pages = Math.max(1, Math.ceil(total / 25));
  const parsed = Number(requestedPage), page = Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(pages, parsed) : 1;
  const rows = await prisma.privacyErasure.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 });
  return <section id="erasures"><h2>Журнал удалений персональных данных</h2>
    <p>Запись подтверждает операции в рабочей базе. Статус файлов показан отдельно; резервные копии выбывают из ротации за 14 дней. Перед восстановлением базы повторно применяются записи независимого журнала. Выгрузка — техническое основание для акта; акт об уничтожении оформляет и подписывает оператор.</p>
    {!rows.length ? <p>Операций удаления пока нет.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Основание</th><th>Заказы</th><th>Обязательное хранение до</th><th>Файлы</th><th>Журнал</th></tr></thead><tbody>{rows.map(row => {
      const plan = erasurePlanSchema.parse(row.plan);
      return <tr key={row.id}><td>{formatDate(row.createdAt)}</td><td>{row.reason === "retention" ? "Истечение срока" : "Подтверждение администратора"}</td><td>{plan.orderIds.length}</td><td>{row.retainedUntil ? formatDate(row.retainedUntil) : "Нет сохранённых обязательных документов"}</td><td>{row.filesRemovedAt ? "Удаление проверено" : "В очереди, уничтожение не завершено"}</td><td><a className="text-link" href={`/api/admin/privacy/erasures/${row.id}/`}>Скачать JSON</a></td></tr>;
    })}</tbody></table></div>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы журнала удалений">{page > 1 && <Link href={`?erasurePage=${page - 1}#erasures`}>Предыдущие</Link>}<span>{page} из {pages}</span>{page < pages && <Link href={`?erasurePage=${page + 1}#erasures`}>Следующие</Link>}</nav>}
    <p><Link href="/account/clients/" className="text-link">Вернуться к клиентам</Link></p>
  </section>;
}
