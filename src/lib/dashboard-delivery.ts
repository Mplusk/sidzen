import { z } from "zod";

const ozonResponse = z.object({ statuses: z.array(z.object({ status: z.string(), status_changed_at: z.string().optional() })).optional() });
const ozonLabels: Record<string, string> = { created: "Создано", forming: "Подтверждается", forming_failed: "Ошибка подтверждения", ready_for_shipping: "Готово к отгрузке", on_way: "В пути", in_delivery_point: "В пункте выдачи", delivered: "Получено", canceled: "Отменено", in_courier_service: "У курьера", acceptance_in_progress: "Приёмка", in_container: "В грузоместе" };
const queueLabels: Record<string, string> = { PENDING: "Ожидает отправки", SENDING: "Создаётся", ACCEPTED: "Ожидает подтверждения", CREATED: "Передано в доставку", REVIEW: "Требуется проверка", CANCELED: "Отменено", CANCELING: "Отменяется", FINISHED: "Завершено — проверьте результат" };
const cdekLabels: Record<string, string> = { DELIVERED: "Получено", NOT_DELIVERED: "Не вручено", ACCEPTED: "Принято", CREATED: "Создано", IN_TRANSIT: "В пути", READY_FOR_RECIPIENT_CITY_DELIVERY: "Готово к выдаче", TAKEN_BY_COURIER: "У курьера" };

export function dashboardDelivery(shipment: { provider: string; method: string; deliveredAt: Date | null; ozonJob: { status: string; response: unknown; cancelRequestedAt: Date | null } | null; cdekJob: { status: string; deliveryStatus: string | null; deliveryStatusChangedAt: Date | null; cancelRequestedAt: Date | null } | null } | null) {
  if (!shipment) return { label: "Не оформлена", changedAt: null as Date | null };
  if (shipment.ozonJob) {
    const job = shipment.ozonJob;
    if (job.cancelRequestedAt && job.status !== "CANCELED") return { label: "Ozon: отмена запрошена", changedAt: null };
    const parsed = ozonResponse.safeParse(job.response);
    const statuses = parsed.success ? parsed.data.statuses : undefined;
    if (statuses?.length) {
      const labels = [...new Set(statuses.map(value => ozonLabels[value.status] ?? "Проверяется"))];
      const dates = statuses.map(value => value.status_changed_at ? Date.parse(value.status_changed_at) : NaN);
      return { label: `Ozon: ${labels.join(", ")}`, changedAt: dates.every(Number.isFinite) ? new Date(Math.max(...dates)) : null };
    }
    return { label: `Ozon: ${queueLabels[job.status] ?? "Проверяется"}`, changedAt: null };
  }
  if (shipment.cdekJob) {
    const job = shipment.cdekJob;
    if (job.cancelRequestedAt && job.status !== "CANCELED") return { label: "СДЭК: отмена запрошена", changedAt: null };
    return { label: `СДЭК: ${job.deliveryStatus ? cdekLabels[job.deliveryStatus] ?? `статус ${job.deliveryStatus}` : queueLabels[job.status] ?? "проверяется"}`, changedAt: job.deliveryStatusChangedAt };
  }
  return { label: shipment.deliveredAt ? `${shipment.provider}: получено` : `${shipment.provider}: ${shipment.method}`, changedAt: null };
}
