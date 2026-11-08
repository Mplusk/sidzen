import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getOzonDeliveryConfig } from "./ozon-config";

const moscowDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
});

export function ozonDirectoryRefreshBoundary(now: Date): Date | null {
  const parts = moscowDate.formatToParts(now);
  const field = (type: string) => parts.find(part => part.type === type)!.value;
  // Moscow uses UTC+03:00; the refresh begins at 03:00 local time, not host time.
  const boundary = new Date(`${field("year")}-${field("month")}-${field("day")}T03:00:00+03:00`);
  return now >= boundary ? boundary : null;
}

export async function scheduleOzonDirectoryRefresh(now = new Date()): Promise<boolean> {
  const boundary = ozonDirectoryRefreshBoundary(now);
  if (!boundary) return false;
  return prisma.$transaction(async tx => {
    // Settings writes use the same lock. Two worker processes cannot schedule
    // two refreshes or enqueue a stale configuration while settings are saved.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    const config = await getOzonDeliveryConfig(tx);
    if (!config.enabled || !config.clientId || !config.clientSecret || !config.shipmentMethodId || !config.checkedAt) return false;
    const sync = await tx.ozonDeliverySync.findUnique({ where: { id: "ozon" } });
    if (sync && (!["SUCCEEDED", "FAILED"].includes(sync.status) || sync.updatedAt >= boundary)) return false;
    const data = {
      clientId: config.clientId, methodId: BigInt(config.shipmentMethodId),
      generation: randomUUID(), cursor: null, status: "PENDING",
      pages: 0, points: 0, error: null, lockToken: null, lockedUntil: null,
      updatedAt: now,
    };
    if (!sync) {
      await tx.ozonDeliverySync.create({ data: { id: "ozon", ...data } });
      return true;
    }
    // updatedAt is a durable daily guard, including failed attempts and worker
    // restarts. Keep the existing directory available while its job refreshes.
    const claimed = await tx.ozonDeliverySync.updateMany({
      where: {
        id: sync.id, generation: sync.generation, updatedAt: sync.updatedAt,
        status: { in: ["SUCCEEDED", "FAILED"] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data,
    });
    return claimed.count === 1;
  });
}
