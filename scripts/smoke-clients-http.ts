// Disposable local fixtures only. Never run against production personal data.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const prefix = `qa-clients-${randomUUID()}`, ids: string[] = [];
let roleId: string | undefined;
const path = "/account/clients/";
async function request(path: string, token?: string) {
  return fetch(new URL(path, base), { redirect: "manual", headers: token ? { Cookie: `3dp_session=${token}` } : {}, signal: AbortSignal.timeout(15000) });
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
  const before = await prisma.user.count(), pages = Math.ceil(before / 50), seen = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    const response = await request(`${path}?page=${page}`, token); assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store|private/);
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
    assert(html.includes(`Страница ${page} из ${pages}`)); assert(!html.includes("SECRET-QA-HASH-MUST-NOT-RENDER")); assert(!html.includes(token));
    const expected = await prisma.user.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50, select: { email: true } });
    for (const row of expected) { assert(html.includes(`mailto:${row.email}`)); if (row.email.startsWith(prefix)) { assert(!seen.has(row.email)); seen.add(row.email); } }
  }
  assert.equal(seen.size, 56); assert.equal(await prisma.user.count(), before);
  const last = (await (await request(`${path}?page=999999`, token)).text()).replace(/<!--[\s\S]*?-->/g, "");
  assert(last.includes(`Страница ${pages} из ${pages}`));
  await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } });
  assert.match((await request(path, token)).headers.get("location") || "", /login/);
  console.log("PASS: private clients directory, anonymous/buyer/inactive denial, customers.read without role-management privilege, all registered accounts across stable pages, no credential disclosure or writes. Local synthetic data only.");
} finally {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (roleId) await prisma.role.deleteMany({ where: { id: roleId } });
  await prisma.$disconnect();
}
