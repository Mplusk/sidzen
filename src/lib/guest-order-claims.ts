import { cookies } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validGuestOrderGrant } from "@/lib/guest-order-grant";

type Grant = { name: string; value: string };

// A signed browser grant proves access to this specific guest order; contact
// information alone is never treated as ownership verification.
export async function claimGrantedGuestOrders(db: PrismaClient, userId: string, grants: Grant[]) {
  const numbers = [...new Set(grants.filter(grant => grant.name.startsWith("3dp_order_")).slice(0, 100).flatMap(grant => {
    const number = grant.name.slice("3dp_order_".length);
    return /^3DP-[A-Za-z0-9-]{1,80}$/.test(number) && validGuestOrderGrant(number, grant.value) ? [number] : [];
  }))];
  if (!numbers.length) return 0;
  return db.$transaction(async tx => {
    // Use the same lock order as deletion and privacy erasure.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412042)`;
    if (!await tx.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } })) return 0;
    const orders = await tx.order.findMany({ where: { number: { in: numbers }, userId: null, deletedAt: null, personalDataErasedAt: null }, select: { id: true } });
    let claimed = 0;
    for (const order of orders) {
      const updated = await tx.order.updateMany({ where: { id: order.id, userId: null, deletedAt: null, personalDataErasedAt: null }, data: { userId } });
      if (!updated.count) continue;
      await tx.auditLog.create({ data: { actorId: userId, action: "order.owner.claim", entityType: "Order", entityId: order.id, before: { userId: null }, after: { userId, proof: "guest-order-grant" } } });
      claimed++;
    }
    return claimed;
  });
}

export async function claimGuestOrders(userId: string) {
  return claimGrantedGuestOrders(prisma, userId, (await cookies()).getAll());
}
