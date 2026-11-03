// Only the disposable local database and local application are allowed.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/integration-secrets.ts";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const db = new PrismaClient(), jar = new Map();
async function request(path, body, authenticated = true) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; ") } : {}), ...(body ? { Origin: base.origin } : {}) }, body });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path, containing) {
  const response = await request(path); assert.equal(response.status, 200);
  const html = await response.text();
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]).find((text) => text.includes(containing));
  assert(markup, "Form missing: " + containing);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return body;
}
const path = "/account/integrations/";
const deliveryName = `QA courier ${Date.now()}`;
const paymentKey = "integrations.tochka", token = "fixture-tochka-jwt-never-public";
const oldPayment = await db.siteSetting.findUnique({ where: { key: paymentKey } });
const oldAudit = (await db.auditLog.findMany({ where: { action: { in: ["integration.payment.update", "integration.delivery.update"] } }, select: { id: true } })).map(row => row.id);
try {
  assert.match((await request(path)).headers.get("location"), /^\/login/);
  const login = await form("/login/", 'name="email"');
  login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const shipping = await form(path, "Добавить доставку");
  for (const [key, value] of Object.entries({ name: deliveryName, description: "Local only", basePrice: "125.50", sortOrder: "9", active: "on" })) shipping.set(key, value);
  assert.equal((await request(path, shipping)).headers.get("location"), path + "?result=saved");
  const method = await db.deliveryMethod.findFirstOrThrow({ where: { name: deliveryName } });
  assert.equal(Number(method.basePrice), 125.5);
  const edit = await form(path, method.id);
  for (const [key, value] of Object.entries({ name: deliveryName, description: "Local only", basePrice: "150", sortOrder: "9" })) edit.set(key, value);
  assert.equal((await request(path, edit)).headers.get("location"), path + "?result=saved");
  assert.equal((await db.deliveryMethod.findUniqueOrThrow({ where: { id: method.id } })).active, false);
  const payment = await form(path, 'name="token"');
  for (const [key, value] of Object.entries({ customerCode: "", merchantId: "", token: "", receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", card: "on", sbp: "on" })) payment.set(key, value);
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=saved");
  assert.equal((await db.siteSetting.findUniqueOrThrow({ where: { key: paymentKey } })).value.enabled, false);
  // A stale enabled request without credentials must not activate online checkout.
  payment.set("enabled", "on");
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=incomplete");
  assert.equal((await db.siteSetting.findUniqueOrThrow({ where: { key: paymentKey } })).value.enabled, false);
  payment.delete("enabled"); payment.set("token", token); payment.set("customerCode", "1234567ab"); payment.set("merchantId", "200000000001097");
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=saved");
  const saved = (await db.siteSetting.findUniqueOrThrow({ where: { key: paymentKey } })).value;
  assert(saved.token.startsWith("v1.") && !saved.token.includes(token));
  assert.equal(decryptSecret(saved.token, paymentKey), token);
  const html = await (await request(path)).text(); assert(html.includes("Точка · интернет-эквайринг") && html.includes("ЮKassa · оплата и чеки")); assert(!html.includes(token) && !html.includes(saved.token));
  assert(!(await (await request("/admin/settings/")).text()).includes(saved.token));
  payment.set("token", "");
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=saved");
  assert.equal(decryptSecret((await db.siteSetting.findUniqueOrThrow({ where: { key: paymentKey } })).value.token, paymentKey), token);
  // Checking with incomplete credentials fails locally and cannot enable payment.
  payment.set("customerCode", ""); payment.set("intent", "check"); payment.set("token", "sandbox.jwt.token");
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=connection");
  assert.equal((await request("/api/payments/tochka/", new FormData(), false)).status, 401);
  const oversize = await fetch(new URL("/api/payments/tochka/", base), { method: "POST", body: "x".repeat(32769) }); assert.equal(oversize.status, 413);
  const user = await db.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const roles = await db.userRole.findMany({ where: { userId: user.id } });
  try {
    await db.userRole.deleteMany({ where: { userId: user.id } });
    assert.match((await request(path)).headers.get("location"), /forbidden/);
    assert.match((await request(path, shipping)).headers.get("location"), /forbidden/);
    assert.match((await request(path, payment)).headers.get("location"), /forbidden/);
  } finally { await db.userRole.createMany({ data: roles, skipDuplicates: true }); }
  for (const route of ["/print/", "/account/models/", "/admin/files/"]) assert.equal((await request(route)).status, 404);
  assert.equal(await db.product.count({ where: { type: "PRINT_TEMPLATE" } }), 0);
  console.log("PASS: admin-only actions, delivery create/edit/disable, Tochka draft settings, encrypted/hidden/retained JWT, disabled and sandbox rejection, unsigned/oversized webhook rejection. No bank requests or charges.");
} finally {
  await db.deliveryMethod.deleteMany({ where: { name: deliveryName } });
  if (oldPayment) await db.siteSetting.upsert({ where: { key: paymentKey }, create: oldPayment, update: { value: oldPayment.value, group: oldPayment.group } }); else await db.siteSetting.deleteMany({ where: { key: paymentKey } });
  await db.auditLog.deleteMany({ where: { action: { in: ["integration.payment.update", "integration.delivery.update"] }, id: { notIn: oldAudit } } });
  await db.$disconnect();
}
