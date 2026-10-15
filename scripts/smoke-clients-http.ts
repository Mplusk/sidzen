// Disposable local fixtures only. Never run against production personal data.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getClientsPage } from "../src/lib/clients";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const prefix = `qa-clients-${randomUUID()}`, ids: string[] = [];
const orderIds: string[] = [], archiveKeys: string[] = [], auditIds: string[] = [];
let roleId: string | undefined;
const path = "/account/clients/";
async function request(path: string, token?: string) {
  return fetch(new URL(path, base), { redirect: "manual", headers: token ? { Cookie: `3dp_session=${token}` } : {}, signal: AbortSignal.timeout(15000) });
}
async function submit(body: FormData, token?: string, origin = base.origin) {
  return fetch(new URL(path, base), { method: "POST", body, redirect: "manual", headers: { Origin: origin, ...(token ? { Cookie: `3dp_session=${token}` } : {}) }, signal: AbortSignal.timeout(15000) });
}
function actionForm(html: string, key: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(text => text.includes(key.replaceAll('&', '&amp;').replaceAll('"', '&quot;'))); assert(markup);
  const body = new FormData();
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = m[0].match(/name="([^"]*)"/)?.[1], value = m[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || m[0].includes('type="hidden"'))) body.set(name.replaceAll('&amp;', '&'), value.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&'));
  }
  return body;
}
try {
  const actor = await prisma.user.create({ data: { email: `${prefix}-actor@example.test`, passwordHash: "SECRET-QA-HASH-MUST-NOT-RENDER", name: "QA Synthetic Staff" } }); ids.push(actor.id);
  const token = randomUUID();
  await prisma.session.create({ data: { userId: actor.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  for (let i = 0; i < 55; i++) ids.push((await prisma.user.create({ data: { email: `${prefix}-${i}@example.test`, passwordHash: "SECRET-QA-HASH-MUST-NOT-RENDER", name: i ? `QA Synthetic Client ${i}` : null, phone: i ? "+79991234567" : null, isActive: i !== 1, createdAt: new Date(Date.now() + i * 1000) } })).id);
  for (const suffix of ["", "?page=2"]) {
    const anon = await request(path + suffix); assert.match(anon.headers.get("location") || "", /login/); assert(!(await anon.text()).includes(prefix));
    const buyer = await request(path + suffix, token); assert.match(buyer.headers.get("location") || "", /forbidden/); assert(!(await buyer.text()).includes(`${prefix}-0@`));
  }
  assert(!(await (await request("/account/", token)).text()).includes('href="/account/clients/"'));
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "customers.read" } });
  const role = await prisma.role.create({ data: { code: prefix, name: "QA customers only", permissions: { create: { permissionId: permission.id } } } }); roleId = role.id;
  await prisma.userRole.create({ data: { userId: actor.id, roleId } });
  assert((await (await request("/account/", token)).text()).includes('href="/account/clients/"'));
  assert.match((await request("/admin/users/", token)).headers.get("location") || "", /forbidden/, "Viewing clients must not grant role management");
  const before = await prisma.user.count(), directoryBefore = await getClientsPage(), pages = directoryBefore.pages, seen = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    const response = await request(`${path}?page=${page}`, token); assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store|private/);
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
    assert(html.includes(`Страница ${page} из ${pages}`)); assert(!html.includes("SECRET-QA-HASH-MUST-NOT-RENDER")); assert(!html.includes(token));
    const expected = (await getClientsPage(page)).clients;
    for (const row of expected) { assert(html.includes(`mailto:${row.email}`)); if (row.email.startsWith(prefix)) { assert(!seen.has(row.id)); seen.add(row.id); } }
  }
  assert.equal(seen.size, 56); assert.equal(await prisma.user.count(), before);
  const last = (await (await request(`${path}?page=999999`, token)).text()).replace(/<!--[\s\S]*?-->/g, "");
  assert(last.includes(`Страница ${pages} из ${pages}`));
  assert(!(await (await request(path, token)).text()).includes("Да, архивировать"), "Read-only staff cannot archive clients");
  async function order(email: string, phone: string, name: string, data = {}) {
    const value = await prisma.order.create({ data: { number: `${prefix}-${orderIds.length}`, customerName: name, customerEmail: email, customerPhone: phone, subtotal: 1, total: 1, kind: "APPLICATION", ...data } }); orderIds.push(value.id); return value;
  }
  const guestEmail = `${prefix}-guest@example.test`;
  await order(guestEmail, "+7 (999) 765-43-21", "QA Guest First");
  await order(guestEmail.toUpperCase(), "89997654321", "QA Guest Confirmed", { status: "DELIVERED", purchaseConfirmedAt: new Date() });
  await order(`${prefix}-different-email@example.test`, "+79997654321", "QA Shared Phone");
  await order(guestEmail, "+79990001122", "QA Different Phone");
  await order(`${prefix}-removed-order@example.test`, "+79990001122", "QA Deleted Order", { deletedAt: new Date() });
  // Complete pair matching suppresses a duplicate contact, but never grants account access.
  await order(`${prefix}-1@example.test`, "+79991234567", "QA Existing Registered Buyer");
  await order(`${prefix}-0@example.test`, "+79999887766", "QA Own Order Name", { userId: ids[1] });
  const combined = await getClientsPage(); assert.equal(combined.total, directoryBefore.total + 3);
  const all = [];
  for (let page = 1; page <= combined.pages; page++) all.push(...(await getClientsPage(page)).clients);
  const guests = all.filter(row => row.source === "ORDER" && row.email.toLowerCase().startsWith(prefix));
  assert.equal(guests.length, 3); assert(guests.some(row => row.name === "QA Guest Confirmed"));
  assert(!all.some(row => row.name === "QA Deleted Order"));
  assert.equal(all.find(row => row.id === `account:${ids[1]}`)?.phone, "+79999887766");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids[1] } })).phone, null, "Directory does not change profile data");
  assert.equal(await prisma.user.count(), before, "Guest contact cards do not silently create login accounts");
  const guest = guests.find(row => row.name === "QA Guest Confirmed")!; archiveKeys.push(guest.id, `account:${actor.id}`);
  const write = await prisma.permission.findUniqueOrThrow({ where: { code: "customers.write" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: write.id } });
  const oldAudits = (await prisma.auditLog.findMany({ where: { actorId: actor.id }, select: { id: true } })).map(row => row.id);
  const guestPage = Math.floor(all.findIndex(row => row.id === guest.id) / 50) + 1;
  const guestHtml = await (await request(`${path}?page=${guestPage}`, token)).text();
  assert(guestHtml.includes("Покупатель без регистрации") && guestHtml.includes("Да, архивировать") && guestHtml.includes("Заказы, документы"));
  const removal = actionForm(guestHtml, guest.id);
  assert.match((await submit(removal, token)).headers.get("location") || "", /confirmation/);
  removal.set("confirmation", "archive");
  assert.match((await submit(removal)).headers.get("location") || "", /login/);
  assert((await submit(removal, token, "https://foreign.invalid")).status >= 400);
  await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: write.id } } });
  assert.match((await submit(removal, token)).headers.get("location") || "", /forbidden/);
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: write.id } });
  const orderState = await prisma.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } });
  const userState = await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
  assert.match((await submit(removal, token)).headers.get("location") || "", /result=deleted/);
  assert.equal((await getClientsPage()).total, combined.total - 1);
  assert.equal((await getClientsPage(1, true)).clients.filter(row => row.id === guest.id).length, 1);
  const archivedHtml = await (await request(`${path}?view=deleted`, token)).text();
  const restore = actionForm(archivedHtml, guest.id); restore.set("confirmation", "restore");
  assert.match((await submit(restore, token)).headers.get("location") || "", /result=restored/);
  assert.equal((await getClientsPage()).total, combined.total);
  const ownRemoval = actionForm(await (await request(path + `?page=${combined.pages}`, token)).text(), `account:${actor.id}`);
  ownRemoval.set("confirmation", "archive"); assert.match((await submit(ownRemoval, token)).headers.get("location") || "", /deleted/);
  assert.equal((await request("/account/", token)).status, 200, "Directory deletion does not disable or destroy accounts");
  const ownRestore = actionForm(await (await request(`${path}?view=deleted`, token)).text(), `account:${actor.id}`);
  ownRestore.set("confirmation", "restore"); await submit(ownRestore, token);
  assert.deepEqual(await prisma.order.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } }), orderState);
  assert.deepEqual(await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }), userState);
  const audits = await prisma.auditLog.findMany({ where: { actorId: actor.id, id: { notIn: oldAudits } } }); auditIds.push(...audits.map(row => row.id));
  assert.equal(audits.length, 4); assert(!JSON.stringify(audits).includes(guestEmail));
  await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } });
  assert.match((await request(path, token)).headers.get("location") || "", /login/);
  console.log("PASS: private directory of registered and guest buyers; normalized full-pair deduplication, confirmed-order inclusion, own-profile fallback, no silent login account creation; authorized confirmed deletion/restoration, CSRF/auth/read-only denial, audit and unchanged accounts/orders. Local synthetic data only.");
} finally {
  await prisma.clientArchive.deleteMany({ where: { key: { in: archiveKeys } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ id: { in: auditIds } }, { actorId: { in: ids }, action: { in: ["client.archive", "client.restore"] } }] } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (roleId) await prisma.role.deleteMany({ where: { id: roleId } });
  await prisma.$disconnect();
}
