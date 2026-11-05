// Synthetic accounts in a disposable local database only.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { setUserArchived } from "../src/lib/user-archive";
import { applyRestoredErasurePlan, eraseUserData } from "../src/lib/privacy-erasure";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && (db.pathname === "/shop_qa" || /^\/sidzen_user_qa_[a-f0-9]{12}$/.test(db.pathname)), "Disposable local QA database only");
assert.equal(process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED, "true");
const prefix = `qa-user-${randomUUID()}`;
const ledger = await mkdtemp(join(tmpdir(), "sidzen-user-qa-"));
process.env.PRIVACY_ERASURE_LEDGER_DIR = ledger;
const ids: string[] = [], orderIds: string[] = [], roleIds: string[] = [], planIds: string[] = [];
let createdSuperRole = false;
try {
  let superRole = await prisma.role.findUnique({ where: { code: "superadmin" } });
  if (!superRole) { superRole = await prisma.role.create({ data: { code: "superadmin", name: "QA superadmin" } }); createdSuperRole = true; }
  const staffRole = await prisma.role.create({ data: { code: prefix, name: "Synthetic staff" } }); roleIds.push(staffRole.id);
  const actor = await prisma.user.create({ data: { email: `${prefix}-actor@example.test`, passwordHash: "fixture", roles: { create: { roleId: superRole.id } } } }); ids.push(actor.id);
  const target = await prisma.user.create({ data: { email: `${prefix}-target@example.test`, passwordHash: "fixture", roles: { create: { roleId: staffRole.id } } } }); ids.push(target.id);
  assert.equal(await setUserArchived(prisma, { actorId: target.id, userId: actor.id, archive: true }), "forbidden");
  await assert.rejects(() => eraseUserData(actor.id, target.id), /forbidden/);
  const archivedOwner = await prisma.user.create({ data: { email: `${prefix}-archived@example.test`, passwordHash: "fixture", isActive: false, roles: { create: { roleId: superRole.id } } } }); ids.push(archivedOwner.id);
  const seedEnv = { ...process.env, BOOTSTRAP_ADMIN_EMAIL: archivedOwner.email, BOOTSTRAP_ADMIN_PASSWORD: "Synthetic-Seed-Password-2026" };
  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { env: seedEnv, stdio: "pipe" });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: archivedOwner.id } })).isActive, false, "Deploy seed must not reactivate an archived owner");
  await prisma.user.delete({ where: { id: archivedOwner.id } });
  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { env: seedEnv, stdio: "pipe" });
  assert.equal(await prisma.user.count({ where: { email: archivedOwner.email } }), 0, "Deploy seed must not recreate a removed owner");
  for (const code of ["users.write", "customers.read", "customers.write", "orders.write"]) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.create({ data: { roleId: staffRole.id, permissionId: permission.id } });
  }
  const activeSuperadmins = await prisma.user.count({ where: { isActive: true, roles: { some: { role: { code: "superadmin" } } } } });
  if (activeSuperadmins === 1) {
    assert.equal(await setUserArchived(prisma, { actorId: target.id, userId: actor.id, archive: true }), "last-superadmin");
    await assert.rejects(() => eraseUserData(actor.id, target.id), /last-superadmin/);
  }
  const session = await prisma.session.create({ data: { userId: target.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  assert.equal(await setUserArchived(prisma, { actorId: actor.id, userId: target.id, archive: true }), "archived");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, false);
  assert.equal(await prisma.session.count({ where: { id: session.id } }), 0);
  assert.equal(await setUserArchived(prisma, { actorId: actor.id, userId: target.id, archive: false }), "restored");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, true);
  assert.equal(await prisma.session.count({ where: { id: session.id } }), 0);
  assert.equal(await setUserArchived(prisma, { actorId: actor.id, userId: actor.id, archive: true }), "self");
  const first = await prisma.user.create({ data: { email: `${prefix}-first@example.test`, passwordHash: "fixture", roles: { create: { roleId: superRole.id } } } }); ids.push(first.id);
  const second = await prisma.user.create({ data: { email: `${prefix}-second@example.test`, passwordHash: "fixture", roles: { create: { roleId: superRole.id } } } }); ids.push(second.id);
  const concurrent = await Promise.all([
    setUserArchived(prisma, { actorId: first.id, userId: second.id, archive: true }),
    setUserArchived(prisma, { actorId: second.id, userId: first.id, archive: true }),
  ]);
  assert.deepEqual(concurrent.sort(), ["archived", "forbidden"], "A blocked actor must not archive another user in a concurrent request");
  await assert.rejects(() => eraseUserData(actor.id, actor.id), /protected/);
  const order = await prisma.order.create({ data: { number: prefix, userId: target.id, kind: "APPLICATION", status: "NEW", customerName: "Synthetic", customerEmail: target.email, customerPhone: "+79990000001", subtotal: 10, total: 10 } }); orderIds.push(order.id);
  await assert.rejects(() => eraseUserData(target.id, actor.id), /active/);
  assert(await prisma.user.findUnique({ where: { id: target.id } }));
  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", privacyClosedAt: new Date() } });
  const settled = await prisma.order.create({ data: { number: `${prefix}-paid`, userId: target.id, kind: "APPLICATION", status: "DELIVERED", purchaseConfirmedAt: new Date(), privacyClosedAt: new Date(), customerName: "Synthetic", customerEmail: target.email, customerPhone: "+79990000001", subtotal: 10, total: 10 } }); orderIds.push(settled.id);
  const plan = await eraseUserData(target.id, actor.id); planIds.push(plan.id);
  assert.equal(plan.scope, "user");
  assert.deepEqual(plan.retainedIds, [settled.id]);
  assert.equal(await prisma.user.count({ where: { id: target.id } }), 0);
  assert.equal(await prisma.order.count({ where: { id: order.id } }), 0);
  const retained = await prisma.order.findUniqueOrThrow({ where: { id: settled.id } });
  assert.equal(retained.userId, null); assert.equal(retained.customerPhone, ""); assert(retained.personalDataErasedAt);
  assert(await prisma.privacyErasure.findUnique({ where: { id: plan.id } }));
  assert(await prisma.auditLog.findFirst({ where: { actorId: actor.id, action: "user.archive", entityId: target.id } }));
  await prisma.user.create({ data: { ...target, roles: { create: { roleId: staffRole.id } } } });
  await applyRestoredErasurePlan(plan);
  assert.equal(await prisma.user.count({ where: { id: target.id } }), 0, "Restoring a backup must replay staff erasure");
  console.log("PASS: archive, session revocation, restore, bootstrap, active-order guard, staff erasure and backup replay (synthetic data).");
} finally {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...ids, ...planIds, ...orderIds] } }] } });
  await prisma.privacyErasure.deleteMany({ where: { id: { in: planIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  if (createdSuperRole) await prisma.role.deleteMany({ where: { code: "superadmin" } });
  await prisma.$disconnect();
  for (const name of await readdir(ledger)) await unlink(join(ledger, name));
  await rmdir(ledger);
}

