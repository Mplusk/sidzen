import type { OrderStatus } from "@prisma/client";

export const applicationStatuses = ["NEW", "APPROVED", "IN_PROGRESS", "PACKED", "SHIPPED", "DELIVERED", "CANCELED"] as const;
export const orderStatuses = ["NEW", "ESTIMATING", "APPROVED", "IN_PROGRESS", "AWAITING_PAYMENT", "PAID", "QUEUED", "PRINTING", "PACKED", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"] as const;
export function orderStatus(status: string) {
  const labels: Record<OrderStatus, string> = {
    NEW: "Новая заявка", ESTIMATING: "На оценке", APPROVED: "Согласован", IN_PROGRESS: "В работе",
    AWAITING_PAYMENT: "Ожидает оплаты", PAID: "Оплачен", QUEUED: "В очереди", PRINTING: "Печатается",
    POST_PROCESSING: "В работе", PACKED: "Упакован", SHIPPED: "Отправлен", DELIVERED: "Получен / выполнен",
    CANCELED: "Отменён", REFUNDED: "Возврат",
  };
  return labels[status as OrderStatus] ?? status;
}
