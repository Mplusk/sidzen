import { z } from "zod";

const day = 86_400_000;
const duration = z.number().int().min(0).max(365);
const requestSchema = z.object({ postings: z.array(z.object({ request_id: z.number().int().positive(), cutoff_at: z.iso.datetime() })).min(1).max(100) });
const responseSchema = z.object({ postings: z.array(z.object({ request_id: z.number().int().positive(), posting_number: z.string(), estimated_delivery_days: duration.nullish() })).min(1).max(100), statuses: z.array(z.object({ posting_number: z.string(), status: z.string() })).optional() });

export type DeliveryEstimate = { kind: "date"; date: string; source: "manual" | "plan" } | { kind: "pending" } | { kind: "ready" } | { kind: "none" };
type Shipment = {
  payload: unknown;
  deliveredAt: Date | null;
  ozonJob: { status: string; request: unknown; response: unknown; cancelRequestedAt: Date | null } | null;
  cdekJob: { status: string; deliveryStatus: string | null; cancelRequestedAt: Date | null } | null;
} | null;

/** Date-only values are validated as calendar dates and never interpreted in the server's local zone. */
export function validDeliveryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function manualDeliveryDate(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).deliveryEstimateDate;
  return validDeliveryDate(value) ? value : null;
}

function moscowDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatDeliveryDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

/** Uses a carrier's original travel duration and planned handover, never polling timestamps as dispatch dates. */
export function estimatedDelivery(shipment: Shipment, orderStatus: string, now = new Date()): DeliveryEstimate {
  if (!shipment || shipment.deliveredAt || ["CANCELED", "REFUNDED"].includes(orderStatus)) return { kind: "none" };
  const ozon = shipment.ozonJob, cdek = shipment.cdekJob;
  if ((ozon && (ozon.cancelRequestedAt || ozon.status === "CANCELED")) || (cdek && (cdek.cancelRequestedAt || cdek.status === "CANCELED"))) return { kind: "none" };
  if (orderStatus === "DELIVERED" && !((ozon && ["PENDING", "CREATED", "REVIEW"].includes(ozon.status)) || (cdek && ["PENDING", "SENDING", "ACCEPTED", "CREATED", "REVIEW"].includes(cdek.status)))) return { kind: "none" };
  const request = requestSchema.safeParse(ozon?.request);
  const response = responseSchema.safeParse(ozon?.response);
  const matched = response.success && request.success && ozon?.status !== "REVIEW" && response.data.postings.length === request.data.postings.length && new Set(request.data.postings.map(item => item.request_id)).size === request.data.postings.length && new Set(response.data.postings.map(item => item.posting_number)).size === response.data.postings.length && request.data.postings.every(item => response.data.postings.filter(posting => posting.request_id === item.request_id).length === 1) && response.data.statuses?.length === response.data.postings.length && response.data.postings.every(posting => response.data.statuses!.filter(item => item.posting_number === posting.posting_number).length === 1) ? response.data.statuses : null;
  if (matched?.every(item => ["in_delivery_point", "delivered"].includes(item.status))) return { kind: "ready" };
  const today = moscowDay(now);
  const manual = manualDeliveryDate(shipment.payload);
  if (manual) return manual >= today ? { kind: "date", date: manual, source: "manual" } : { kind: "pending" };
  if (!ozon || !["PENDING", "CREATED"].includes(ozon.status)) return { kind: "pending" };
  if (!request.success || new Set(request.data.postings.map(item => item.request_id)).size !== request.data.postings.length) return { kind: "pending" };
  const quoteDays = duration.safeParse(shipment.payload && typeof shipment.payload === "object" && !Array.isArray(shipment.payload) ? (shipment.payload as Record<string, unknown>).estimatedDays : null);
  const byRequest = response.success && response.data.postings.length === request.data.postings.length && request.data.postings.every(item => response.data.postings.filter(posting => posting.request_id === item.request_id).length === 1) ? response.data.postings : null;
  // A planned handover that has passed without evidence of transit is not a current forecast.
  const inTransit = matched?.every(item => ["on_way", "in_delivery_point", "in_courier_service", "in_container", "delivered"].includes(item.status));
  if (!inTransit && request.data.postings.some(item => moscowDay(new Date(item.cutoff_at)) < today)) return { kind: "pending" };
  const dates = request.data.postings.map(item => {
    const days = byRequest?.find(posting => posting.request_id === item.request_id)?.estimated_delivery_days ?? (quoteDays.success ? quoteDays.data : null);
    return days === null ? null : moscowDay(new Date(Date.parse(item.cutoff_at) + days * day));
  });
  if (dates.some(value => value === null)) return { kind: "pending" };
  const latest = (dates as string[]).sort().at(-1)!;
  return latest >= today ? { kind: "date", date: latest, source: "plan" } : { kind: "pending" };
}
