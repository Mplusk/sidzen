import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { connectionKey, POLICY_KEY } from "../src/lib/marketplaces/model";
import { Prisma } from "@prisma/client";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const jar = new Map<string, string>();
async function request(path: string, body?: FormData, authenticated = true, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) }, body });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path: string, containing: string) {
  const response = await request(path); assert.equal(response.status, 200);
  const html = await response.text();
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]).find((text) => text.replace(/<!--[\s\S]*?-->/g, "").includes(containing));
  assert(markup, `Missing form: ${containing}`);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return body;
}
const path = "/account/marketplaces/", secret = "fixture-http-super-secret";
const old = await prisma.siteSetting.findUnique({ where: { key: connectionKey("ozon") } });
const oldPolicy = await prisma.siteSetting.findUnique({ where: { key: POLICY_KEY } });
let jobId: string | undefined;
try {
  assert.match((await request(path)).headers.get("location") || "", /^\/login/);
  const login = await form("/login/", 'name="email"'); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const config = { accountId: "local-fixture", clientId: "123", name: "Local fixture", secret: encryptSecret(secret, connectionKey("ozon")), checkedAt: new Date().toISOString() };
  await prisma.siteSetting.upsert({ where: { key: connectionKey("ozon") }, create: { key: connectionKey("ozon"), group: "integrations", value: config }, update: { value: config } });
  const html = await (await request(path)).text();
  assert(html.includes("Local fixture")); assert(!html.includes(secret)); assert(!html.includes(config.secret));
  assert(!(await (await request("/admin/settings/")).text()).includes(secret));
  const policy = await form(path, 'name="primary"'); policy.set("primary", "wb"); policy.set("categoryId", "");
  assert.equal((await request(path, policy)).headers.get("location"), path + "?result=saved");
  assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: POLICY_KEY } })).value && ((await prisma.siteSetting.findUniqueOrThrow({ where: { key: POLICY_KEY } })).value as { primary: string }).primary, "wb");
  policy.set("primary", "ozon");
  assert([400, 403, 500].includes((await request(path, policy, true, "https://foreign.invalid")).status));
  assert.equal(((await prisma.siteSetting.findUniqueOrThrow({ where: { key: POLICY_KEY } })).value as { primary: string }).primary, "wb");
  const start = await form(path, "Синхронизировать Ozon");
  assert.equal((await request(path, start)).headers.get("location"), path + "?result=queued");
  const job = await prisma.marketplaceSyncRun.findFirstOrThrow({ where: { accountId: "local-fixture", status: "QUEUED" } }); jobId = job.id;
  assert.equal((await request(path, start)).headers.get("location"), path + "?result=busy");
  assert.equal((await request(path, policy)).headers.get("location"), path + "?result=busy");
  const cancel = await form(path, "Остановить текущий запуск");
  assert.equal((await request(path, cancel)).headers.get("location"), path + "?result=canceled");
  assert.equal((await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id: job.id } })).status, "CANCELED");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
  try {
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    assert.match((await request(path)).headers.get("location") || "", /forbidden/);
    assert.match((await request(path, policy)).headers.get("location") || "", /forbidden/);
    assert.match((await request(path, start)).headers.get("location") || "", /forbidden/);
  } finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  assert.match((await request(path, policy, false)).headers.get("location") || "", /^\/login/);
  assert.equal((await fetch(new URL("/api/internal/catalog-invalidate/", base), { method: "POST", headers: { Authorization: "Bearer " + "é".repeat(64) } })).status, 403);
  console.log("PASS: marketplace admin page/actions, encrypted-key redaction, policy validation, manual queue/start/stop, concurrent-start prevention, admin permissions, anonymous denial and CSRF. No marketplace API requests.");
} finally {
  if (jobId) await prisma.marketplaceSyncRun.delete({ where: { id: jobId } });
  for (const [key, row] of [[connectionKey("ozon"), old], [POLICY_KEY, oldPolicy]] as const) {
    if (row) await prisma.siteSetting.upsert({ where: { key }, create: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue }, update: { value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  await prisma.$disconnect();
}
