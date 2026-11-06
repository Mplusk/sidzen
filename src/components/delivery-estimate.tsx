import type { DeliveryEstimate as Estimate } from "@/lib/delivery/estimated-date";
import { formatDeliveryDate } from "@/lib/delivery/estimated-date";
import styles from "./delivery-estimate.module.css";

export function DeliveryEstimate({ estimate }: { estimate: Estimate }) {
  if (estimate.kind === "none") return null;
  if (estimate.kind === "pending") return <small className={styles.estimate}>Дата доставки уточняется</small>;
  if (estimate.kind === "ready") return <small className={styles.estimate}>В пункте выдачи</small>;
  return <small className={styles.estimate}>Ожидается: <time dateTime={estimate.date}>{formatDeliveryDate(estimate.date)}</time><span>{estimate.source === "plan" ? "Расчёт по плановой отгрузке" : "Ориентир магазина"}</span></small>;
}
