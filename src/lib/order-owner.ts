import type { PrismaClient } from "@prisma/client";
import { revokeGuestGrantsForOrder } from "@/lib/guest-order-grant";

export type LinkOrderOwnerResult = "linked" | "already" | "changed" | "missing" | "mismatch" | "forbidden" | "completed";

/** An administrator attests ownership; an email match by itself grants nothing. */
export async function linkOrderOwner(db: PrismaClient, input: { actorId: string; orderId: string; orderNumber: string; targetUserId: string; expectedOwnerId: string | null }): Promise<LinkOrderOwnerResult> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412042)`;
    const actor = await tx.user.findUnique({ where: { id: input.actorId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    const permissions = new Set(actor?.roles.flatMap(row => row.role.permissions.map(link => link.permission.code)) ?? []);
    if (!actor?.isActive || (!actor.roles.some(row => row.role.code === "superadmin") && !(permissions.has("users.write") && permissions.has("orders.write")))) return "forbidden";
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, number: true, userId: true, status: true, purchaseConfirmedAt: true, customerEmail: true, deletedAt: true, personalDataErasedAt: true } });
    const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, email: true, isActive: true } });
    if (!order || !target?.isActive || order.deletedAt || order.personalDataErasedAt) return "missing";
    if (order.number !== input.orderNumber || !order.customerEmail.trim() || order.customerEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) return "mismatch";
    if (order.userId === target.id) return "already";
    if (order.userId !== input.expectedOwnerId) return "changed";
    if (order.userId && (order.purchaseConfirmedAt || ["DELIVERED", "CANCELED", "REFUNDED"].includes(order.status))) return "completed";
    const updated = await tx.order.updateMany({ where: { id: order.id, userId: input.expectedOwnerId, deletedAt: null, personalDataErasedAt: null }, data: { userId: target.id } });
    if (!updated.count) return "changed";
    await revokeGuestGrantsForOrder(tx, order.number);
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "order.owner.assign", entityType: "Order", entityId: order.id, before: { userId: order.userId }, after: { userId: target.id, confirmation: "administrator" } } });
    return "linked";
  });
}
