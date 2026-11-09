// Isolated PostgreSQL fixtures only; never use email alone as ownership proof.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createGuestGrant, guestGrantAllows, guestOrderSignature, revokeGuestGrant } from "../src/lib/guest-order-grant";
import { claimGrantedGuestOrders } from "../src/lib/guest-order-claims";
import { linkOrderOwner } from "../src/lib/order-owner";
import { dashboardDelivery } from "../src/lib/dashboard-delivery";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && (db.pathname === "/shop_qa" || /^\/sidzen_account_test_\d+$/.test(db.pathname)), "Only isolated local QA databases are allowed");
const prefix = randomUUID();
const users: string[] = [], orders: string[] = [];
let createdRole: string | undefined;
async function user(email: string) {
  const value = await prisma.user.create({ data: { email, name: "Synthetic buyer", passwordHash: "qa-not-a-password" } }); users.push(value.id); return value;
}
async function order(email: string, userId: string | null = null) {
  const value = await prisma.order.create({ data: { number: `3DP-QA-${prefix}-${orders.length}`, status: "SHIPPED", customerName: "Synthetic buyer", customerEmail: email, customerPhone: "+70000000000", subtotal: 240, total: 240, userId, shipment: { create: { provider: "ozon-delivery", method: "QA", ozonJob: { create: { clientId: "qa", status: "CREATED", request: {}, response: { statuses: [{ status: "on_way", status_changed_at: "2030-01-01T12:00:00Z" }] } } } } } } }); orders.push(value.id); return value;
}
try {
  const previousRole = await prisma.role.findUnique({ where: { code: "superadmin" } });
  const role = previousRole ?? await prisma.role.create({ data: { code: "superadmin", name: "Synthetic QA role" } });
  if (!previousRole) createdRole = role.id;
  const admin = await user(`admin-${prefix}@example.test`), buyer = await user(`buyer-${prefix}@example.test`), other = await user(`other-${prefix}@example.test`);
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
  const guest = await order(buyer.email), forged = await order(buyer.email), alreadyOwned = await order(buyer.email, other.id), deleted = await order(buyer.email), erased = await order(buyer.email), manual = await order(buyer.email), transfer = await order(buyer.email, other.id), completed = await order(buyer.email, other.id);
  await prisma.order.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  await prisma.order.update({ where: { id: erased.id }, data: { personalDataErasedAt: new Date() } });
  await prisma.order.update({ where: { id: completed.id }, data: { status: "DELIVERED" } });
  const grant = (number: string) => ({ name: `3dp_order_${number}`, value: guestOrderSignature(number) });
  const liveToken = await createGuestGrant(prisma, manual.number);
  assert.equal(await guestGrantAllows(prisma, manual, liveToken), true);
  await revokeGuestGrant(prisma, manual.number, liveToken);
  assert.equal(await guestGrantAllows(prisma, manual, liveToken), false);
  const replacementToken = await createGuestGrant(prisma, manual.number);
  const grants = [grant(guest.number), { ...grant(forged.number), value: "0".repeat(64) }, grant(alreadyOwned.number), grant(deleted.number), grant(erased.number)];
  assert.equal(await claimGrantedGuestOrders(prisma, buyer.id, grants), 1);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: guest.id } })).userId, buyer.id);
  assert.equal(await guestGrantAllows(prisma, guest, grant(guest.number).value), false, "Claim must revoke the old guest cookie even if ownership is later cleared");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: forged.id } })).userId, null);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: alreadyOwned.id } })).userId, other.id);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: deleted.id } })).userId, null);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: erased.id } })).userId, null);
  assert.equal(await claimGrantedGuestOrders(prisma, buyer.id, grants), 0);
  const input = { actorId: admin.id, orderId: manual.id, orderNumber: manual.number, targetUserId: buyer.id, expectedOwnerId: null };
  assert.equal(await linkOrderOwner(prisma, { ...input, actorId: other.id }), "forbidden");
  assert.equal(await linkOrderOwner(prisma, { ...input, targetUserId: other.id }), "mismatch");
  assert.equal(await linkOrderOwner(prisma, input), "linked");
  assert.equal(await guestGrantAllows(prisma, manual, replacementToken), false, "Owner assignment must revoke existing grants");
  assert.equal(await guestGrantAllows(prisma, manual, grant(manual.number).value), false, "Owner assignment must revoke legacy signatures");
  assert.equal(await linkOrderOwner(prisma, input), "already");
  assert.equal(await linkOrderOwner(prisma, { ...input, orderId: transfer.id, orderNumber: transfer.number }), "changed");
  assert.equal(await linkOrderOwner(prisma, { ...input, orderId: transfer.id, orderNumber: transfer.number, expectedOwnerId: other.id }), "linked");
  assert.equal(await linkOrderOwner(prisma, { ...input, orderId: completed.id, orderNumber: completed.number, expectedOwnerId: other.id }), "completed");
  const visible = await prisma.order.findMany({ where: { id: { in: orders }, userId: buyer.id, deletedAt: null }, include: { shipment: { include: { ozonJob: true, cdekJob: true } } } });
  assert.deepEqual(new Set(visible.map(value => value.id)), new Set([guest.id, manual.id, transfer.id]));
  assert(visible.every(value => dashboardDelivery(value.shipment).label === "Ozon: В пути"));
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: manual.id } })).status, "SHIPPED");
  assert.equal(await prisma.auditLog.count({ where: { entityId: { in: [guest.id, manual.id, transfer.id] }, action: { in: ["order.owner.claim", "order.owner.assign"] } } }), 3);
  console.log("PASS account orders: signed guest claims, privileged verified assignment, stale-owner and access checks, shipment status and audit.");
} finally {
  await prisma.guestOrderGrant.deleteMany({ where: { orderNumber: { startsWith: `3DP-QA-${prefix}` } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: orders } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (createdRole) await prisma.role.delete({ where: { id: createdRole } });
  await prisma.$disconnect();
}
