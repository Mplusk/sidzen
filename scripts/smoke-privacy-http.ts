// Isolated local synthetic QA only. Does not contact external processors.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const prefix = `qa-erasure-http-${randomUUID()}`, ids: string[] = [], path = "/account/clients/";
const token = randomUUID(), buyerToken = randomUUID(); let roleId = "", orderId = "", erasureId = "";
async function get(path: string, session: string = token) { return fetch(new URL(path, base), { redirect: "manual", headers: session ? { Cookie: `3dp_session=${session}` } : {} }); }
async function submit(body: FormData, session: string = token, origin = base.origin) { return fetch(new URL(path, base), { redirect: "manual", method: "POST", body, headers: { Origin: origin, ...(session ? { Cookie: `3dp_session=${session}` } : {}) } }); }
function eraseForm(html: string, key: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes(key) && value.includes('name="phrase"')); assert(markup);
  const form = new FormData();
  for (const input of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || input[0].includes('type="hidden"'))) form.set(name.replaceAll("&amp;", "&"), value.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  return form;
}
try {
  const actor = await prisma.user.create({ data: { email: `${prefix}-staff@example.test`, passwordHash: "fixture", name: "Synthetic privacy staff" } }); ids.push(actor.id);
  const buyer = await prisma.user.create({ data: { email: `${prefix}-buyer@example.test`, passwordHash: "fixture", name: "Synthetic erasure target", createdAt: new Date(Date.now() + 3600000) } }); ids.push(buyer.id);
  for (const [userId, session] of [[actor.id, token], [buyer.id, buyerToken]]) await prisma.session.create({ data: { userId, tokenHash: createHash("sha256").update(session).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  const permissions = await prisma.permission.findMany({ where: { code: { in: ["customers.read", "customers.write", "users.write", "orders.write"] } } });
  assert.equal(permissions.length, 4);
  const role = await prisma.role.create({ data: { code: prefix, name: "Synthetic privacy role", permissions: { create: permissions.filter(permission => permission.code === "customers.read").map(permission => ({ permissionId: permission.id })) } } }); roleId = role.id;
  await prisma.userRole.create({ data: { userId: actor.id, roleId } });
  assert(!(await (await get(path)).text()).includes("Необратимо удалить данные"));
  for (const permission of permissions.filter(permission => permission.code !== "customers.read")) await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
  const order = await prisma.order.create({ data: { number: prefix, userId: buyer.id, kind: "APPLICATION", status: "CANCELED", privacyClosedAt: new Date(), customerName: buyer.name!, customerEmail: buyer.email, customerPhone: "+79990000000", subtotal: 10, total: 10 } }); orderId = order.id;
  const html = await (await get(path)).text(); assert(html.includes("Архивировать") && html.includes("Необратимо удалить данные"));
  const form = eraseForm(html, `account:${buyer.id}`);
  assert.match((await submit(form)).headers.get("location") || "", /confirmation/);
  form.set("phrase", "УДАЛИТЬ"); form.set("verified", "on"); form.set("confirmation", "erase");
  assert.match((await submit(form, "")).headers.get("location") || "", /login/);
  assert((await submit(form, token, "https://foreign.invalid")).status >= 400);
  const accountPermission = permissions.find(permission => permission.code === "users.write")!;
  await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: accountPermission.id } } });
  assert.match((await submit(form)).headers.get("location") || "", /forbidden/);
  assert(await prisma.user.findUnique({ where: { id: buyer.id } }));
  await prisma.rolePermission.create({ data: { roleId, permissionId: accountPermission.id } });
  assert.match((await submit(form)).headers.get("location") || "", /result=erased/);
  assert.equal(await prisma.user.count({ where: { id: buyer.id } }), 0);
  assert.equal(await prisma.order.count({ where: { id: orderId } }), 0);
  assert.match((await get("/account/profile/", buyerToken)).headers.get("location") || "", /login/);
  const record = await prisma.privacyErasure.findFirstOrThrow({ where: { plan: { path: ["userId"], equals: buyer.id } } }); erasureId = record.id;
  const exportPath = `/api/admin/privacy/erasures/${record.id}/`;
  assert.equal((await get(exportPath, "")).status, 401);
  const exported = await get(exportPath); assert.equal(exported.status, 200); assert.match(exported.headers.get("cache-control") || "", /no-store/);
  const evidence = await exported.text(); assert(!evidence.includes(buyer.email) && !evidence.includes(buyer.name!)); assert(evidence.includes("не подписанный акт"));
  const policy = await (await get("/legal/privacy/", "")).text();
  assert(policy.includes("24 месяцев") && policy.includes("14 дней") && policy.includes("не позднее 30 дней"));
  assert(!policy.includes("Привязку можно удалить в профиле"));
  assert(policy.includes("передача текста отзывов в DeepSeek заблокирована"));
  console.log("PASS: irreversible HTTP erasure confirmation/auth/permissions/CSRF, actual deletion/session revocation, private evidence export and current retention/transfer policy. Local fixtures only.");
} finally {
  if (!erasureId && ids[1]) erasureId = (await prisma.privacyErasure.findFirst({ where: { plan: { path: ["userId"], equals: ids[1] } } }))?.id || "";
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, ...(erasureId ? [{ entityId: erasureId }] : [])] } });
  if (erasureId) {
    await prisma.privacyErasure.deleteMany({ where: { id: erasureId } });
    await unlink(join(process.env.PRIVACY_ERASURE_LEDGER_DIR || join(process.cwd(), "privacy-ledger"), `${erasureId}.json.enc`)).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (roleId) await prisma.role.delete({ where: { id: roleId } });
  await prisma.$disconnect();
}
