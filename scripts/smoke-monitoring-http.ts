// Synthetic local shop_qa only; no external visitor/geo/analytics APIs.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { pruneMonitoring } from "../src/lib/monitoring";
import { MONITORING_COOKIE, readMonitoringConsent } from "../src/lib/monitoring-policy";
const base = new URL(process.env.SMOKE_BASE_URL ?? "http://localhost:3101"), db = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa", "Disposable local QA only");
const admin = new Map<string, string>(), guest = new Map<string, string>(), buyer = new Map<string, string>();
const settings = await prisma.siteSetting.findMany({ where: { key: { in: ["legal.seller", "legal.address", "contacts.email"] } } });
const oldAudits = (await prisma.auditLog.findMany({ where: { action: "monitoring.clear" }, select: { id: true } })).map(row => row.id);
let buyerId: string | undefined;
async function request(path: string, body?: FormData | string, jar = guest, origin?: string, extra: Record<string, string> = {}) {
  const response = await fetch(new URL(path, base), { method: body !== undefined ? "POST" : "GET", redirect: "manual", body, headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body !== undefined ? { Origin: origin ?? (body instanceof FormData ? base.origin : process.env.NEXT_PUBLIC_SITE_URL ?? base.origin) } : {}), ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}), ...extra } });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
async function form(path: string, contains: string, jar: Map<string, string>) {
  const response = await request(path, undefined, jar); assert.equal(response.status, 200);
  const html = await response.text(), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes(contains)); assert(markup);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) { const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(decode(name), decode(value)); }
  return body;
}
try {
  await prisma.monitoringVisit.deleteMany(); await prisma.monitoringConsent.deleteMany();
  for (const [key, value] of [["legal.seller", "Synthetic QA operator"], ["legal.address", "Synthetic QA address"], ["contacts.email", "qa@example.test"]]) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  const finance = [await prisma.order.count(), await prisma.user.count(), await prisma.diagnosticLog.count()];
  assert.match((await request("/account/monitoring/")).headers.get("location")!, /login/);
  const user = await prisma.user.create({ data: { email: `monitor-${randomUUID()}@example.test`, name: "Synthetic visitor", passwordHash: "!qa" } }); buyerId = user.id;
  const session = randomUUID(); await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(session).digest("hex"), expiresAt: new Date(Date.now() + 600000) } }); buyer.set("3dp_session", session);
  assert.match((await request("/account/monitoring/", undefined, buyer)).headers.get("location")!, /forbidden/);
  const visit = randomUUID(), page = randomUUID(), view = JSON.stringify({ type: "view", visit, page, path: "/catalog/", search: "лампа", referrer: "https://www.google.com/search?q=светильник&token=secret" });
  assert.equal((await request("/api/monitoring/", view)).status, 403);
  assert.equal((await request("/api/monitoring/consent/?choice=allow", "", guest, "https://foreign.invalid")).status, 403);
  assert.equal((await request("/api/monitoring/consent/?choice=allow", "", guest, undefined, { DNT: "1" })).status, 403);
  assert.equal(await prisma.monitoringVisit.count(), 0);
  assert.equal((await request("/api/monitoring/consent/?choice=allow", "")).status, 204);
  const oldCookie = guest.get(MONITORING_COOKIE)!; assert(readMonitoringConsent(oldCookie));
  assert.equal((await request("/api/monitoring/", view, guest, undefined, { "X-Forwarded-For": "8.8.8.8" })).status, 204);
  assert.equal((await request("/api/monitoring/", view)).status, 204); // Idempotent view.
  const geoVisit = randomUUID();
  assert.equal((await request("/api/monitoring/", JSON.stringify({ type: "view", visit: geoVisit, page: randomUUID(), path: "/catalog/" }), guest, undefined, { "X-Sidzen-Client-IP": "8.8.8.8" })).status, 204);
  const geo = await prisma.monitoringVisit.findFirstOrThrow({ where: { ip: "8.8.8.8" } }); assert.equal(geo.country, "US");
  await prisma.monitoringVisit.delete({ where: { id: geo.id } });
  const stored = await prisma.monitoringVisit.findFirstOrThrow({ include: { pages: true } });
  assert.equal(stored.ip, null); assert.equal(stored.source, "www.google.com"); assert.equal(stored.searchPhrase, "светильник"); assert.equal(stored.pages.length, 1);
  assert.equal((await request("/api/monitoring/", JSON.stringify({ type: "view", visit, page: randomUUID(), path: "/account/orders/" }))).status, 204);
  assert.equal(await prisma.monitoringPage.count(), 1);
  assert.equal((await request("/api/monitoring/", "x".repeat(5000))).status, 413);
  const heartbeat = JSON.stringify({ type: "heartbeat", visit, page, seconds: 999 });
  assert.equal((await request("/api/monitoring/", heartbeat)).status, 204);
  assert((await prisma.monitoringPage.findFirstOrThrow()).activeSeconds <= 2, "Cannot inflate time");
  await prisma.monitoringVisit.update({ where: { id: stored.id }, data: { createdAt: new Date(Date.now() - 31 * 86400000) } });
  await pruneMonitoring(); assert.equal(await prisma.monitoringVisit.count(), 0); assert.equal(await prisma.monitoringPage.count(), 0);
  assert.equal((await request("/api/monitoring/", heartbeat)).status, 204); assert.equal(await prisma.monitoringPage.count(), 0);
  assert.equal((await request("/api/monitoring/", view)).status, 204);
  assert.equal((await request("/api/monitoring/consent/?choice=deny", "")).status, 204); assert.equal(await prisma.monitoringVisit.count(), 0);
  guest.set(MONITORING_COOKIE, oldCookie); assert.equal((await request("/api/monitoring/", view)).status, 403); assert.equal(await prisma.monitoringVisit.count(), 0);
  assert.equal((await request("/api/monitoring/consent/?choice=allow", "")).status, 204); assert.equal((await request("/api/monitoring/", view)).status, 204);
  const login = await form("/login/", 'name="email"', admin); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026"); assert.equal((await request("/login/", login, admin)).headers.get("location"), "/account/");
  const html = await (await request("/account/monitoring/", undefined, admin)).text(); assert(html.includes("Мониторинг") && html.includes("www.google.com") && html.includes("Очистить мониторинг"));
  const deletion = await form("/account/monitoring/", "clear-all-monitoring", admin);
  assert.match((await request("/account/monitoring/", deletion, admin)).headers.get("location")!, /confirmation/);
  deletion.set("confirmation", "clear-all-monitoring"); assert.match((await request("/account/monitoring/", deletion, buyer)).headers.get("location")!, /forbidden/);
  assert((await request("/account/monitoring/", deletion, admin, "https://foreign.invalid")).status >= 400);
  assert.equal(await prisma.monitoringVisit.count(), 1);
  assert.match((await request("/account/monitoring/", deletion, admin)).headers.get("location")!, /cleared/);
  assert.equal(await prisma.monitoringVisit.count(), 0); assert.equal(await prisma.monitoringPage.count(), 0); assert.equal(await prisma.monitoringConsent.count(), 0);
  assert.equal(await prisma.order.count(), finance[0]); assert.equal(await prisma.user.count(), finance[1] + 1);
  assert.equal((await request("/api/monitoring/", heartbeat)).status, 403);
  console.log("PASS: consent/withdrawal/replay, private paths, source sanitization, time clamp, cascaded 30-day retention, admin-only journal and confirmed clearing preserve orders/users. No external calls.");
} finally {
  await prisma.monitoringVisit.deleteMany(); await prisma.monitoringConsent.deleteMany();
  await prisma.auditLog.deleteMany({ where: { action: "monitoring.clear", id: { notIn: oldAudits } } });
  if (buyerId) await prisma.user.delete({ where: { id: buyerId } });
  for (const key of ["legal.seller", "legal.address", "contacts.email"]) { const old = settings.find(row => row.key === key); if (old) await prisma.siteSetting.update({ where: { key }, data: { value: old.value! } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
