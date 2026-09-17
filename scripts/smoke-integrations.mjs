// Only the disposable local database and local application are allowed.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
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
try {
  assert.match((await request(path)).headers.get("location"), /^\/login/);
  const login = await form("/login/", 'name="email"');
  login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const shipping = await form(path, "Добавить доставку");
  for (const [key, value] of Object.entries({ name: "QA courier", description: "Local only", basePrice: "125.50", sortOrder: "9", active: "on" })) shipping.set(key, value);
  assert.equal((await request(path, shipping)).headers.get("location"), path + "?result=saved");
  const method = await db.deliveryMethod.findFirstOrThrow({ where: { name: "QA courier" } });
  assert.equal(Number(method.basePrice), 125.5);
  const edit = await form(path, method.id);
  for (const [key, value] of Object.entries({ name: "QA courier", description: "Local only", basePrice: "150", sortOrder: "9" })) edit.set(key, value);
  assert.equal((await request(path, edit)).headers.get("location"), path + "?result=saved");
  assert.equal((await db.deliveryMethod.findUniqueOrThrow({ where: { id: method.id } })).active, false);
  const payment = await form(path, 'name="shopId"');
  for (const [key, value] of Object.entries({ shopId: "", secret: "", receiptMode: "provider", vatCode: "1", taxSystemCode: "" })) payment.set(key, value);
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=saved");
  assert.equal((await db.siteSetting.findUniqueOrThrow({ where: { key: "integrations.yookassa" } })).value.enabled, false);
  // A stale enabled request without credentials must not activate online checkout.
  payment.set("enabled", "on");
  assert.equal((await request(path, payment)).headers.get("location"), path + "?result=incomplete");
  assert.equal((await db.siteSetting.findUniqueOrThrow({ where: { key: "integrations.yookassa" } })).value.enabled, false);
  const user = await db.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const roles = await db.userRole.findMany({ where: { userId: user.id } });
  try {
    await db.userRole.deleteMany({ where: { userId: user.id } });
    assert.match((await request(path)).headers.get("location"), /forbidden/);
    assert.match((await request(path, shipping)).headers.get("location"), /forbidden/);
  } finally { await db.userRole.createMany({ data: roles, skipDuplicates: true }); }
  for (const route of ["/print/", "/account/models/", "/admin/files/"]) assert.equal((await request(route)).status, 404);
  assert.equal(await db.product.count({ where: { type: "PRINT_TEMPLATE" } }), 0);
  console.log("PASS: admin-only page/actions, delivery create/edit/disable, payment save and validation, retired service absent. No provider requests or charges.");
} finally { await db.$disconnect(); }
