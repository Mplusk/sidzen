import type { Prisma } from "@prisma/client";
import { reserveStock } from "@/lib/stock-reservations";

type Tx = Prisma.TransactionClient;
const EXPIRATION_MARKER = "stock-reservation-expired";

/** Called under payment locks after a verified payment or an operator retry. */
export async function restoreExpiredOrderStock(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: [{ productId: "asc" }, { id: "asc" }] });
  if (!items.length || items.some(item => !item.productId || item.stockReservationState === "ACTIVE")) return false;
  let reserved: Map<string, number>;
  try {
    reserved = await reserveStock(tx, items.map(item => ({ productId: item.productId!, quantity: item.quantity })));
  } catch (error) {
    if (error instanceof Error && ["stock-changed", "stock-legacy-review"].includes(error.message)) return false;
    throw error;
  }
  for (const item of items) {
    const quantity = Math.min(item.quantity, reserved.get(item.productId!) ?? 0);
    reserved.set(item.productId!, (reserved.get(item.productId!) ?? 0) - quantity);
    await tx.orderItem.update({ where: { id: item.id }, data: { reservedStock: quantity, stockReservationState: quantity ? "ACTIVE" : "NONE" } });
  }
  // Reactivate only jobs canceled by this timeout, not a merchant cancellation.
  await tx.ozonDeliveryJob.updateMany({ where: { shipment: { orderId }, status: "CANCELED", attempts: 0, cancelError: EXPIRATION_MARKER }, data: { status: "PENDING", cancelRequestedAt: null, cancelError: null, nextAttemptAt: new Date() } });
  await tx.cdekDeliveryJob.updateMany({ where: { shipment: { orderId }, status: "CANCELED", attempts: 0, error: EXPIRATION_MARKER }, data: { status: "PENDING", cancelRequestedAt: null, error: null, nextAttemptAt: new Date() } });
  await tx.fivePostDeliveryJob.updateMany({ where: { shipment: { orderId }, status: "CANCELED", attempts: 0, error: EXPIRATION_MARKER }, data: { status: "PENDING", cancelRequestedAt: null, error: null, nextAttemptAt: new Date() } });
  return true;
}

export { EXPIRATION_MARKER };
