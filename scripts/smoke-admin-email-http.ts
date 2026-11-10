import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { removeUserRole } from "../src/lib/user-role-removal";
import { setUserArchived } from "../src/lib/user-archive";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa", "Only the isolated QA database is allowed");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const flag = "security.admin_email_confirmation", smtpKey = "notifications.smtp.spaceweb";
const priorFlag = await prisma.siteSetting.findUnique({ where: { key: flag } });
const priorSmtp = await prisma.siteSetting.findUnique({ where: { key: smtpKey } });
const privileged = await prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { OR: [{ code: "superadmin" }, { permissions: { some: {} } }] } } } }, select: { id: true } });
const role = await prisma.role.findUniqueOrThrow({ where: { code: "superadmin" } });
const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "admin" } });
const suffix = randomUUID(), passwordHash = "fixture-password-hash", sessionToken = random(), binding = random(), revision = randomUUID();
let userId = "", otherId = "";
let recoveryAuditId = "";
const cookies = `3dp_session=${sessionToken}; 3dp_admin_login=${binding}`;
async function confirm(token: string, intent = "enroll", cookie = cookies, origin = "https://sidzen.shop") {
  return fetch(new URL("/admin-login-confirm/", base), { method: "POST", redirect: "manual", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token, intent }) });
}
async function issue(purpose = "enroll", expiresAt = new Date(Date.now() + 60000)) {
  const token = random();
  await prisma.adminLoginChallenge.create({ data: { tokenHash: hash(token), bindingHash: hash(binding), userId, email: `admin-${suffix}@example.test`, passwordFingerprint: hash(passwordHash), returnTo: "/admin/security/", purpose, sessionHash: hash(sessionToken), smtpRevision: revision, expiresAt } });
  return token;
}
try {
  await prisma.user.updateMany({ where: { id: { in: privileged.map(x => x.id) } }, data: { isActive: false } });
  const user = await prisma.user.create({ data: { email: `admin-${suffix}@example.test`, passwordHash, roles: { create: { roleId: role.id } } } }); userId = user.id;
  await prisma.session.create({ data: { userId, tokenHash: hash(sessionToken), expiresAt: new Date(Date.now() + 600000) } });
  await prisma.siteSetting.upsert({ where: { key: smtpKey }, create: { key: smtpKey, group: "integrations", value: { password: encryptSecret("fixture-only", smtpKey), checkedAt: new Date().toISOString(), revision } }, update: { value: { password: encryptSecret("fixture-only", smtpKey), checkedAt: new Date().toISOString(), revision } } });
  await prisma.siteSetting.deleteMany({ where: { key: flag } });
  const page = await fetch(new URL("/admin-login-confirm/", base)), html = await page.text(), inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.equal(page.status, 200); assert(inline);
  assert(page.headers.get("content-security-policy")?.includes(`sha256-${createHash("sha256").update(inline).digest("base64")}`));
  assert(page.headers.get("content-security-policy")?.includes("default-src 'none'"));
  assert.equal(page.headers.get("x-frame-options"), "DENY"); assert.match(page.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await confirm(await issue("enroll", new Date(Date.now() - 1000)))).status, 400);
  const token = await issue();
  assert.equal((await confirm(token, "login")).status, 400, "Intent mismatch cannot enable protection");
  assert.equal((await confirm(token, "enroll", cookies, "https://evil.invalid")).status, 400);
  const other = await prisma.user.create({ data: { email: `staff-${suffix}@example.test`, passwordHash, roles: { create: { roleId: adminRole.id } } } }); otherId = other.id;
  assert.equal((await confirm(token)).status, 400, "Other active staff prevents enrollment");
  await prisma.user.update({ where: { id: otherId }, data: { isActive: false } });
  const [one, two] = await Promise.all([confirm(token), confirm(token)]);
  assert.deepEqual([one.status, two.status].sort(), [303, 400], "Only one concurrent POST may use the link");
  assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: flag } })).value, true);
  assert((await prisma.session.findUniqueOrThrow({ where: { tokenHash: hash(sessionToken) } })).adminVerifiedAt, "Original browser remains usable");
  assert.equal((await confirm(token)).status, 400);
  const settings = await fetch(new URL("/admin/settings/", base), { headers: { Cookie: `3dp_session=${sessionToken}` }, redirect: "manual" });
  assert.equal(settings.status, 200);
  const settingsHtml = await settings.text();
  assert(!settingsHtml.includes(flag), "Protected setting must not appear in generic settings");
  const markup = [...settingsHtml.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(s => s.includes('name="key"'));
  assert(markup, "Expected a generic settings form");
  const settingBody = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && name.startsWith("$ACTION")) settingBody.set(name, value);
  }
  settingBody.set("key", flag); settingBody.set("value", "false");
  const blocked = await fetch(new URL("/admin/settings/", base), { method: "POST", redirect: "manual", headers: { Cookie: `3dp_session=${sessionToken}`, Origin: base.origin }, body: settingBody });
  assert.equal(blocked.status, 303); assert.match(blocked.headers.get("location") ?? "", /error=key/);
  assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: flag } })).value, true, "Direct generic action must not disable 2FA");
  await prisma.user.update({ where: { id: otherId }, data: { isActive: true } });
  const targetSession = await prisma.session.create({ data: { userId: otherId, tokenHash: hash(random()), expiresAt: new Date(Date.now() + 600000), adminVerifiedAt: new Date() } });
  await prisma.adminLoginChallenge.create({ data: { tokenHash: hash(random()), bindingHash: hash(random()), userId: otherId, email: other.email, passwordFingerprint: hash(passwordHash), returnTo: "/admin/", expiresAt: new Date(Date.now() + 60000) } });
  assert.equal(await removeUserRole(prisma, { actorId: userId, userId: otherId, roleId: adminRole.id }), "removed");
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: targetSession.id } })).adminVerifiedAt, null);
  assert.equal(await prisma.adminLoginChallenge.count({ where: { userId: otherId, consumedAt: null } }), 0);
  await prisma.userRole.create({ data: { userId: otherId, roleId: adminRole.id } });
  const oldChallenge = await prisma.adminLoginChallenge.create({ data: { tokenHash: hash(random()), bindingHash: hash(random()), userId: otherId, email: other.email, passwordFingerprint: hash(passwordHash), returnTo: "/admin/", expiresAt: new Date(Date.now() + 60000) } });
  assert.equal(await setUserArchived(prisma, { actorId: userId, userId: otherId, archive: true }), "archived");
  assert.equal(await setUserArchived(prisma, { actorId: userId, userId: otherId, archive: false }), "restored");
  assert((await prisma.adminLoginChallenge.findUniqueOrThrow({ where: { id: oldChallenge.id } })).consumedAt, "Archive and restore must not revive an old link");
  await prisma.userRole.delete({ where: { userId_roleId: { userId: otherId, roleId: adminRole.id } } });
  const customerSession = await prisma.session.create({ data: { userId: otherId, tokenHash: hash(random()), expiresAt: new Date(Date.now() + 600000) } });
  const doc = await readFile("docs/admin-email-recovery.md", "utf8"), sql = doc.match(/```sql\s+([\s\S]*?)```/)?.[1];
  assert(sql, "Expected documented recovery transaction");
  const runRecovery = () => spawnSync("psql", ["--dbname", process.env.DATABASE_URL!, "--set", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  const recovery = runRecovery(); assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: flag } })).value, false);
  assert.equal(await prisma.session.count({ where: { userId } }), 0, "Recovery revokes privileged sessions");
  assert(await prisma.session.findUnique({ where: { id: customerSession.id } }), "Recovery retains customer sessions");
  assert.equal(await prisma.adminLoginChallenge.count(), 0);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "security.admin-email.emergency-disable" }, orderBy: { createdAt: "desc" } });
  recoveryAuditId = audit.id;
  assert.notEqual(runRecovery().status, 0, "Recovery must fail closed if already disabled");
  console.log("PASS: isolated CSP, expired/mismatched/replayed links, concurrent consumption, staff enrollment guard and role revocation.");
} finally {
  await prisma.auditLog.deleteMany({ where: { actorId: userId || "no-fixture-user" } });
  if (recoveryAuditId) await prisma.auditLog.deleteMany({ where: { id: recoveryAuditId } });
  if (otherId) await prisma.user.deleteMany({ where: { id: otherId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.updateMany({ where: { id: { in: privileged.map(x => x.id) } }, data: { isActive: true } });
  for (const [key, old] of [[flag, priorFlag], [smtpKey, priorSmtp]] as const) {
    if (old) await prisma.siteSetting.upsert({ where: { key }, create: { key, group: old.group, label: old.label, value: old.value! }, update: { group: old.group, label: old.label, value: old.value! } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  await prisma.$disconnect();
}

