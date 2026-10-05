// Disposable local QA only. No payment, carrier or fiscal APIs are contacted.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { LOG_MAX_ROWS, pruneDiagnosticLogs, writeDiagnostic } from "../src/lib/diagnostics";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa", "Disposable local shop_qa only");
const oldLogs = await prisma.diagnosticLog.findMany();
const oldClearAudits = (await prisma.auditLog.findMany({ where: { action: "diagnostics.clear" }, select: { id: true } })).map(x => x.id);
const admin = new Map<string, string>(), anon = new Map<string, string>(), buyer = new Map<string, string>();
let buyerId: string | undefined;
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
async function request(path: string, body?: FormData, jar = anon, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join("; "), ...(body ? { Origin: origin } : {}) }, body });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path: string, contains: string, jar: Map<string,string>) {
  const response = await request(path, undefined, jar); assert.equal(response.status, 200);
  const html = await response.text(), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(x => x[0]).find(x => x.includes(contains)); assert(markup);
  const body = new FormData();
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) { const name = m[0].match(/name="([^"]*)"/)?.[1], value = m[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || m[0].includes('type="hidden"'))) body.set(decode(name), decode(value)); }
  return body;
}
const path = "/account/logs/";
async function financeCounts() { return [await prisma.order.count(), await prisma.payment.count(), await prisma.fiscalReceipt.count(), await prisma.privacyConsent.count()]; }
try {
  const login = await form("/login/", 'name="email"', admin); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login, admin)).headers.get("location"), "/account/");
  assert.match((await request(path)).headers.get("location")!, /login/);
  const user = await prisma.user.create({ data: { email: `logs-${randomUUID()}@example.test`, passwordHash: "!qa-only", name: "Synthetic QA buyer" } }); buyerId = user.id;
  const token = randomUUID(); await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } }); buyer.set("3dp_session", token);
  assert.match((await request(path, undefined, buyer)).headers.get("location")!, /forbidden/);
  const before = await financeCounts(), beforeAudit = await prisma.auditLog.count();
  await prisma.diagnosticLog.deleteMany({});
  // Bulk local fixtures exercise real row cap and same-timestamp tie-breaking.
  await prisma.diagnosticLog.createMany({ data: Array.from({ length: LOG_MAX_ROWS + 5 }, (_, i) => ({ id: `qa-log-${String(i).padStart(6,"0")}`, reference: randomUUID(), area: "worker", level: "INFO", code: "worker.cache", details: {}, createdAt: new Date("2020-01-01Z") })) });
  const refs = await Promise.all(Array.from({ length: 5 }, () => writeDiagnostic("delivery.transport", { stage: "recheck", durationMs: 30 })));
  assert(refs.every(Boolean)); assert.equal(await prisma.diagnosticLog.count(), LOG_MAX_ROWS);
  await pruneDiagnosticLogs(); assert.equal(await prisma.diagnosticLog.count(), 5);
  const target = refs[0]!;
  await prisma.diagnosticLog.create({ data: { reference: randomUUID(), area: "social", level: "INFO", code: "social.ok", details: { email: "MUST-NOT-RENDER@example.test", token: "MUST-NOT-RENDER-secret", reason: "MUST-NOT-RENDER-secret" } } });
  const all = await (await request(path, undefined, admin)).text(); assert(all.includes("Удалить все логи") && all.includes("confirm-dialog") && all.includes("Отмена")); assert(!all.includes("MUST-NOT-RENDER"));
  const filter = await (await request(`${path}?area=delivery&level=ERROR&reference=${target}`, undefined, admin)).text(); assert(filter.includes(target)); assert(!filter.includes("Ответ провайдера входа успешно обработан"));
  const unknown = await (await request(`${path}?reference=wrong%3Cscript%3E`, undefined, admin)).text(); assert(unknown.includes("Записей пока нет"));
  const deletion = await form(path, "delete-all-diagnostic-logs", admin);
  assert.match((await request(path, deletion, admin)).headers.get("location")!, /result=confirmation/); assert.equal(await prisma.diagnosticLog.count(), 6);
  deletion.set("confirmation", "delete-all-diagnostic-logs");
  assert.match((await request(path, deletion)).headers.get("location")!, /login/);
  assert.match((await request(path, deletion, buyer)).headers.get("location")!, /forbidden/);
  assert((await request(path, deletion, admin, "https://foreign.invalid")).status >= 400);
  assert.equal(await prisma.diagnosticLog.count({ where: { area: "delivery" } }), 5); assert.equal(await prisma.diagnosticLog.count({ where: { area: "social" } }), 1);
  assert.equal(await prisma.diagnosticLog.count({ where: { code: "server.failed" } }), 1, "Rejected CSRF is captured as a generic server event without request data");
  await prisma.diagnosticLog.createMany({ data: Array.from({ length: 50 }, () => ({ reference: randomUUID(), area: "worker", level: "WARN", code: "worker.cache", details: {} })) });
  const pageTwo = (await (await request(`${path}?page=2`, undefined, admin)).text()).replace(/<!--[\s\S]*?-->/g, ""); assert(pageTwo.includes("Страница 2 из 2") && pageTwo.includes("Предыдущая страница"));
  const deletingCount = await prisma.diagnosticLog.count();
  assert.match((await request(path, deletion, admin)).headers.get("location")!, /result=cleared/);
  assert.equal(await prisma.diagnosticLog.count(), 0); assert.deepEqual(await financeCounts(), before); assert.equal(await prisma.auditLog.count(), beforeAudit + 1);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "diagnostics.clear", id: { notIn: oldClearAudits } } }); assert.deepEqual(audit.after, { deletedCount: deletingCount });
  const newReference = await writeDiagnostic("delivery.quote.ok"); assert(newReference);
  assert.equal(await prisma.diagnosticLog.count(), 1);
  console.log("PASS: real PostgreSQL concurrent 10,000-row cap and 30-day retention, admin journal, filters, sanitization, anonymous/buyer/CSRF denial, confirmation, clear-all preserves orders/payments/receipts/consents/audit, new events resume. No real financial or delivery APIs.");
} finally {
  await prisma.diagnosticLog.deleteMany({}); if (oldLogs.length) await prisma.diagnosticLog.createMany({ data: oldLogs.map(row => ({ ...row, details: row.details ?? Prisma.JsonNull })) });
  await prisma.auditLog.deleteMany({ where: { action: "diagnostics.clear", id: { notIn: oldClearAudits } } });
  if (buyerId) await prisma.user.deleteMany({ where: { id: buyerId } });
  await prisma.$disconnect();
}
