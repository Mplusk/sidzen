// Disposable local fixtures only: no real customers, providers or remote calls.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, access, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { eraseClientData, eraseExpiredOrders, eraseInactiveAccount } from "../src/lib/privacy-erasure";
import { replayErasureLedger } from "../src/lib/privacy-erasure-restore";
import { getClientsPage } from "../src/lib/clients";

const database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa", "Disposable local shop_qa only");
assert.equal(process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED, "true");
const prefix = `qa-privacy-${randomUUID()}`, ledger = await mkdtemp(join(tmpdir(), "sidzen-privacy-qa-"));
process.env.PRIVACY_ERASURE_LEDGER_DIR = ledger;
const users: string[] = [], orders: string[] = [], plans: string[] = [], managedFiles: string[] = [];
let productId = "", protectedRole = "";
const now = new Date(), old = new Date("2019-01-01Z");
async function user(suffix: string, data = {}) {
  const row = await prisma.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: "Synthetic buyer", phone: "+79990000001", passwordHash: "fixture-not-a-password", ...data } }); users.push(row.id); return row;
}
async function order(userId: string | null, suffix: string, data = {}) {
  const row = await prisma.order.create({ data: { number: `${prefix}-${suffix}`, userId, kind: "APPLICATION", status: "CANCELED", customerName: "PRIVATE_SYNTHETIC_NAME", customerEmail: `${prefix}-buyer@example.test`, customerPhone: "+79990000001", shippingAddress: "PRIVATE_SYNTHETIC_ADDRESS", customerComment: "PRIVATE_SYNTHETIC_COMMENT", internalNote: "PRIVATE_SYNTHETIC_NOTE", subtotal: 10, total: 10, privacyClosedAt: now, ...data } }); orders.push(row.id); return row;
}
async function trackedErase(key: string, actorId: string) { const result = await eraseClientData(key, actorId); plans.push(result.id); return result; }
try {
  const actor = await user("staff"), buyer = await user("buyer"), neighbor = await user("neighbor");
  const role = await prisma.role.create({ data: { code: prefix, name: "Synthetic protected staff" } }); protectedRole = role.id;
  await prisma.userRole.create({ data: { userId: actor.id, roleId: role.id } });
  productId = (await prisma.product.create({ data: { sku: prefix, slug: prefix, name: "Synthetic product", basePrice: 10 } })).id;
  const own = await order(buyer.id, "own"), guest = await order(null, "guest"), deletedGuest = await order(null, "deleted", { deletedAt: now });
  const guestArchiveKey = `order:${createHash("sha256").update(JSON.stringify([buyer.email, "79990000001"]).replace('","', '", "')).digest("hex")}`;
  await prisma.clientArchive.create({ data: { key: guestArchiveKey } });
  const other = await order(neighbor.id, "neighbor", { customerEmail: neighbor.email });
  await prisma.address.create({ data: { userId: buyer.id, city: "Synthetic", postalCode: "000000", street: "PRIVATE_SYNTHETIC_ADDRESS" } });
  await prisma.socialAccount.create({ data: { userId: buyer.id, provider: "vk", clientId: "fixture", subject: randomUUID() } });
  await prisma.session.create({ data: { userId: buyer.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  await prisma.cart.create({ data: { userId: buyer.id } });
  const photo = `${randomUUID()}.webp`, modelName = `${randomUUID()}.stl`;
  await mkdir(join(process.cwd(), "private-uploads", "reviews"), { recursive: true });
  for (const [name, directory] of [[photo, "reviews"], [modelName, ""]]) {
    const path = join(process.cwd(), "private-uploads", directory, name); managedFiles.push(path); await writeFile(path, "synthetic bytes", { flag: "wx" });
  }
  const model = await prisma.customerModelFile.create({ data: { ownerId: buyer.id, originalName: "PRIVATE_SYNTHETIC_NAME.stl", storedName: modelName, extension: "stl", mimeType: "application/octet-stream", sizeBytes: 15n, sha256: randomUUID() } });
  await prisma.orderItem.create({ data: { orderId: own.id, productName: "Synthetic product", modelFileId: model.id, quantity: 1, unitPrice: 10, totalPrice: 10, configuration: { note: "PRIVATE_SYNTHETIC_COMMENT" } } });
  const consent = await prisma.privacyConsent.create({ data: { userId: buyer.id, purpose: "review", subjectHash: "fixture", version: "fixture", document: {} } });
  await prisma.review.create({ data: { userId: buyer.id, productId, author: "Synthetic", text: "PRIVATE_SYNTHETIC_REVIEW", rating: 5, consentId: consent.id, images: { create: { fileName: photo, width: 1, height: 1 } } } });
  const erased = await trackedErase(`account:${buyer.id}`, actor.id);
  assert.equal(erased.retainedIds.length, 0);
  assert.equal(await prisma.user.count({ where: { id: buyer.id } }), 0);
  assert.equal(await prisma.session.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.address.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.review.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.cart.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.socialAccount.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.privacyConsent.count({ where: { userId: buyer.id } }), 0);
  assert.equal(await prisma.clientArchive.count({ where: { key: guestArchiveKey } }), 0, "Remove the guest archive identity too");
  for (const id of [own.id, guest.id, deletedGuest.id]) {
    assert.equal(await prisma.order.count({ where: { id } }), 0, "No unpaid order-number stubs without an independent basis");
  }
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: other.id } })).customerEmail, neighbor.email, "A shared phone cannot erase another account");
  for (const file of managedFiles) await assert.rejects(access(file));
  const receipt = await prisma.privacyErasure.findUniqueOrThrow({ where: { id: erased.id } }); assert(receipt.filesRemovedAt);
  for (const file of await readdir(ledger)) assert(!(await readFile(join(ledger, file), "utf8")).includes("PRIVATE_SYNTHETIC"));

  const active = await user("active"); await order(active.id, "active", { status: "NEW", privacyClosedAt: null });
  await assert.rejects(() => trackedErase(`account:${active.id}`, actor.id), /active/);
  await assert.rejects(() => trackedErase(`account:${actor.id}`, actor.id), /protected/);
  await assert.rejects(() => trackedErase(`account:${actor.id}`, neighbor.id), /protected/);
  assert(await prisma.user.findUnique({ where: { id: active.id } }));
  const held = await user("held"); await order(held.id, "held", { retentionHoldUntil: new Date(Date.now() + 86400000) });
  await assert.rejects(() => trackedErase(`account:${held.id}`, actor.id), /active/);

  const paidBuyer = await user("paid");
  const paid = await order(paidBuyer.id, "paid", { status: "DELIVERED", purchaseConfirmedAt: now, customerEmail: paidBuyer.email });
  await prisma.payment.create({ data: { orderId: paid.id, provider: "fixture", status: "PAID", paidAt: now, amount: 10, payload: { phone: "PRIVATE_SYNTHETIC_PHONE" } } });
  await prisma.fiscalReceipt.create({ data: { orderId: paid.id, kind: "ADVANCE", status: "PROCESSED", publicId: "fixture", inn: "fixture", request: "synthetic-encrypted-fiscal-evidence", amount: 10, processedAt: now } });
  const retained = await trackedErase(`account:${paidBuyer.id}`, actor.id);
  assert.deepEqual(retained.retainedIds, [paid.id]); assert(retained.retainedUntil);
  const historical = await prisma.order.findUniqueOrThrow({ where: { id: paid.id }, include: { payment: true, fiscalReceipts: true } });
  assert.equal(historical.customerEmail, paidBuyer.email); assert.equal(historical.customerPhone, ""); assert.equal(historical.shippingAddress, null); assert.equal(historical.payment?.payload, null); assert.equal(historical.fiscalReceipts.length, 1);
  assert.equal(await prisma.user.count({ where: { id: paidBuyer.id } }), 0);
  const page = await getClientsPage(); assert(!page.clients.some(row => row.email === paidBuyer.email));

  // A restored old subject is erased again by ID; a fresh same-email signup is not.
  const newcomer = await user("newcomer", { email: buyer.email });
  await prisma.user.create({ data: { ...buyer, email: `${prefix}-restored@example.test` } });
  await prisma.order.create({ data: { ...own, userId: buyer.id } });
  for (const path of managedFiles) await writeFile(path, "restored synthetic bytes");
  await replayErasureLedger();
  assert.equal(await prisma.user.count({ where: { id: buyer.id } }), 0); assert(await prisma.user.findUnique({ where: { id: newcomer.id } }));
  assert.equal(await prisma.order.count({ where: { id: own.id } }), 0);
  for (const path of managedFiles) await assert.rejects(access(path));

  const expired = await order(null, "expired", { createdAt: old, updatedAt: old, privacyClosedAt: old });
  await eraseExpiredOrders([expired.id], now);
  assert.equal(await prisma.order.count({ where: { id: expired.id } }), 0);
  const expiredFinancial = await order(null, "expired-financial", { status: "DELIVERED", createdAt: old, updatedAt: old, privacyClosedAt: old, purchaseConfirmedAt: old });
  await eraseExpiredOrders([expiredFinancial.id], now);
  assert.equal(await prisma.order.count({ where: { id: expiredFinancial.id } }), 0);
  const inactive = await user("inactive", { createdAt: old, updatedAt: old, lastActiveAt: old });
  const inactivePlan = await eraseInactiveAccount(inactive.id, now); assert.equal(inactivePlan, undefined);
  assert.equal(await prisma.user.count({ where: { id: inactive.id } }), 0);
  await assert.rejects(() => eraseInactiveAccount(newcomer.id, now), /active/);
  console.log("PASS: actual account/contact/review/file erasure, exact guest grouping including archived orders, session revocation, active/staff/hold protection, separate fiscal evidence, expiry, inactivity and offline tombstone replay without deleting a new same-email account. Synthetic local fixtures only.");
} finally {
  const records = await prisma.privacyErasure.findMany({ select: { id: true, plan: true } });
  const ownPlans = records.filter(row => plans.includes(row.id) || JSON.stringify(row.plan).includes(prefix) || users.some(id => JSON.stringify(row.plan).includes(id)) || orders.some(id => JSON.stringify(row.plan).includes(id))).map(row => row.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: [...orders, ...ownPlans] } }] } });
  await prisma.privacyErasure.deleteMany({ where: { id: { in: ownPlans } } });
  await prisma.fiscalReceipt.deleteMany({ where: { orderId: { in: orders } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.privacyConsent.deleteMany({ where: { userId: { in: users } } });
  if (productId) await prisma.product.delete({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (protectedRole) await prisma.role.delete({ where: { id: protectedRole } });
  for (const path of managedFiles) await rm(path, { force: true });
  assert(ledger.startsWith(join(tmpdir(), "sidzen-privacy-qa-"))); await rm(ledger, { recursive: true, force: true });
  await prisma.$disconnect();
}
