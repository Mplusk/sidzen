import type { OzonDeliveryJob } from "@prisma/client";
import { z } from "zod";
import { manageOzonShipment } from "@/app/actions/ozon-shipments";

const responseSchema = z.object({ order_number: z.string(), postings: z.array(z.object({ posting_number: z.string() })), statuses: z.array(z.object({ posting_number: z.string(), status: z.string() })).optional() });
const labels: Record<string, string> = { created: "Создано", forming: "Подтверждается", forming_failed: "Ошибка подтверждения", ready_for_shipping: "Готово к отгрузке", on_way: "В пути", in_delivery_point: "В ПВЗ", delivered: "Доставлено", canceled: "Отменено", in_courier_service: "У курьера", acceptance_in_progress: "Приёмка", in_container: "В грузоместе" };
export function OzonShipmentPanel({ job, number }: { job: OzonDeliveryJob; number: string }) {
  const parsed = responseSchema.safeParse(job.response); const response = parsed.success ? parsed.data : null;
  return <div className="admin-card"><h2>Ozon Доставка</h2>
    <p>{job.status === "PENDING" ? "Ожидает оплаты/подтверждения и передачи в Ozon" : job.status === "REVIEW" ? "Неполный ответ Ozon — требуется сверка" : job.status === "CREATED" ? "Передан в Ozon" : job.status === "FINISHED" ? "Доставка завершена" : "Отменено"}</p>
    {job.status === "REVIEW" && <p className="notice notice--danger">Часть отправлений не подтверждена. Известные номера сохранены ниже. Автоматическая передача остановлена: сверьте заказ в Ozon. Повторная проверка создания использует тот же идентификатор и не создаёт новый заказ; до сверки удаление заблокировано.</p>}
    {job.error && <p className="notice notice--danger">Ozon не подтвердил действие ({job.error}). Заказ сохранён; повторная передача использует тот же ключ, без дублей. Проверьте кабинет Ozon и настройки подключения.</p>}
    {response && <><p>Заказ Ozon: {response.order_number}</p><ul>{response.postings.map(posting => <li key={posting.posting_number}>{posting.posting_number} · {labels[response.statuses?.find(value => value.posting_number === posting.posting_number)?.status || "created"] || "Проверяется"} · <a className="text-link" href={`/api/admin/ozon-delivery/label/?jobId=${encodeURIComponent(job.id)}&posting=${encodeURIComponent(posting.posting_number)}`} target="_blank" rel="noreferrer">Этикетка PDF</a></li>)}</ul></>}
    <form action={manageOzonShipment} className="form-grid"><input type="hidden" name="jobId" value={job.id} />
      {(job.status === "PENDING" || job.status === "REVIEW") && <button className="button button--small" name="intent" value="create">{job.status === "REVIEW" ? "Повторно проверить создание заказа" : "Передать подтверждённый заказ в Ozon"}</button>}
      {job.status === "REVIEW" && !!response?.postings.length && <button className="button button--outline" name="intent" value="status">Обновить известные отправления</button>}
      {job.status === "CREATED" && <><button className="button button--outline" name="intent" value="status">Обновить статусы Ozon</button><button className="button" name="intent" value="approve">Подтвердить готовность к отгрузке</button></>}
    </form>
    {(job.status === "CREATED" || job.status === "REVIEW") && !!response?.postings.length && <details><summary>Отмена отправлений Ozon</summary><form action={manageOzonShipment} className="form-grid"><input name="jobId" type="hidden" value={job.id} /><p>Это отменит известные отправления заказа в Ozon, если их ещё можно отменить. Локальный заказ и оплата автоматически не отменяются.</p><label className="field">Для подтверждения введите {number}<input name="confirmation" required autoComplete="off" /></label><button className="button button--outline" name="intent" value="cancel">Отменить отправления в Ozon</button></form></details>}
    {job.status === "PENDING" && job.attempts === 0 && <details><summary>Отменить передачу в Ozon</summary><form action={manageOzonShipment} className="form-grid"><input name="jobId" type="hidden" value={job.id} /><label className="field">Для подтверждения введите {number}<input name="confirmation" required autoComplete="off" /></label><button className="button button--outline" name="intent" value="cancel-pending">Отменить ещё не переданную доставку</button></form></details>}
    <p className="muted">Для оплаты по счёту сначала подтвердите оплату либо переведите проверенный заказ в APPROVED. Этикетка доступна только после перехода отправления в ready_for_shipping. Подтверждение готовности проверяет баланс в Ozon. При ручной отмене заказа отдельно отмените доставку.</p>
  </div>;
}
