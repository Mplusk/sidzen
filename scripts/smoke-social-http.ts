// HTTP/UI verification against disposable local QA only. No provider is contacted.
import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import { encryptSecret, decryptSecret } from "../src/lib/integration-secrets";
import { hash, randomToken } from "../src/lib/social/flow";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), url = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/shop_qa");
const db = new PrismaClient(), admin = new Map<string, string>(), anon = new Map<string, string>();
const oauthCookie = "__Host-3dp_oauth_yandex"; // HTTP server runs a production build.
const keys = ["auth.social.google", "auth.social.vk", "auth.social.yandex"];
const old = await db.siteSetting.findMany({ where: { key: { in: keys } } });
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const oldOperator = await db.siteSetting.findMany({ where: { key: { in: operatorKeys } } });
const oldAudit = (await db.auditLog.findMany({ where: { action: { startsWith: "auth.social" } }, select: { id: true } })).map(r => r.id);
const ids: string[] = [], buyerIds: string[] = [], tag = randomToken().slice(0, 8).toLowerCase();
const decode = (v: string) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
async function request(path: string, body?: FormData, jar = anon, origin = base.origin) {
  const r = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { Origin: origin } : {}) }, body });
  for (const cookie of r.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1)); else jar.delete(pair.slice(0, at)); }
  return r;
}
async function form(path: string, contains: string, jar = anon) {
  const r = await request(path, undefined, jar); assert.equal(r.status, 200);
  const html = await r.text(), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(m => m.includes(contains));
  assert(markup, `Missing form: ${contains}`);
  const body = new FormData();
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) { const name = m[0].match(/name="([^"]*)"/)?.[1], value = m[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || m[0].includes('type="hidden"'))) body.set(decode(name), decode(value)); }
  return body;
}
const settings = "/account/integrations/";
try {
  for (const [key, value] of [["legal.seller", "Synthetic QA operator"], ["legal.address", "Synthetic QA address"], ["contacts.email", "operator@example.test"]]) await db.siteSetting.upsert({ where: { key }, create: { key, group: "qa", value }, update: { value } });
  const login = await form("/login/", 'name="email"', admin); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login, admin)).headers.get("location"), "/account/");
  assert.match((await request(settings)).headers.get("location")!, /login/);
  const yandex = await form(settings, 'value="yandex"', admin);
  for (const [k, v] of Object.entries({ clientId: "b".repeat(32), clientSecret: "qa-yandex-secret-never-public", operatorReviewed: "on", enabled: "on" })) yandex.set(k, v);
  assert.match((await request(settings, yandex)).headers.get("location")!, /login/);
  assert.match((await request(settings, yandex, admin)).headers.get("location")!, /social-saved/);
  const stored = await db.siteSetting.findUniqueOrThrow({ where: { key: keys[2] } }), value = stored.value as { clientSecret: string; revision: string; clientId: string };
  assert.equal(decryptSecret(value.clientSecret, keys[2]), "qa-yandex-secret-never-public");
  const settingsHtml = await (await request(settings, undefined, admin)).text();
  assert(!settingsHtml.includes("qa-yandex-secret-never-public") && !settingsHtml.includes(value.clientSecret));
  const google = await form(settings, 'value="google"', admin);
  for (const [k, v] of Object.entries({ clientId: "123456-fixture.apps.googleusercontent.com", clientSecret: "qa-google-secret", operatorReviewed: "on", enabled: "on" })) google.set(k, v);
  assert.match((await request(settings, google, admin)).headers.get("location")!, /social-incomplete/, "Google legal gate cannot be bypassed by checkbox");
  const start = await form("/login/", 'name="socialConsent"'); start.set("provider", "yandex"); start.set("returnTo", "//evil.test");
  assert.match((await request("/login/", start)).headers.get("location")!, /social-consent/);
  start.set("socialConsent", "on");
  const beforeCsrf = await db.oAuthAttempt.count();
  assert((await request("/login/", start, anon, "https://foreign.invalid")).status >= 400);
  assert.equal(await db.oAuthAttempt.count(), beforeCsrf, "foreign-origin action cannot start OAuth");
  const begin = await request("/login/", start), authUrl = new URL(begin.headers.get("location")!);
  assert.equal(authUrl.hostname, "oauth.yandex.ru"); assert(authUrl.searchParams.get("code_challenge")); assert(!authUrl.toString().includes("qa-yandex-secret"));
  const state = authUrl.searchParams.get("state")!, binding = anon.get(oauthCookie)!;
  const attempt = await db.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: hash(state) } }); ids.push(attempt.id);
  assert.equal(attempt.returnTo, "/account/"); assert.equal(attempt.stage, "STARTED"); assert.equal(attempt.bindingHash, hash(binding));
  const cookie = begin.headers.getSetCookie().find(v => v.startsWith(oauthCookie + "="))!; assert(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=lax") && cookie.includes("Max-Age=600") && !cookie.toLowerCase().includes("domain="));
  const stolen = await request(`/api/auth/social/yandex/callback/?state=${state}&code=fixture`, undefined, new Map());
  assert.match(stolen.headers.get("location")!, /social-expired/); assert.equal((await db.oAuthAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).stage, "STARTED");
  const cancel = await request(`/api/auth/social/yandex/callback/?state=${state}&error=access_denied`);
  assert.match(cancel.headers.get("location")!, /social-canceled/); assert.equal(await db.oAuthAttempt.count({ where: { id: attempt.id } }), 0);
  const replay = await request(`/api/auth/social/yandex/callback/?state=${state}&code=fixture`); assert.match(replay.headers.get("location")!, /social-expired/);
  assert.equal((await fetch(new URL("/api/auth/social/yandex/callback/", base), { method: "POST" })).status, 405);
  // Simulate the already independently tested provider response in local DB.
  const revision = (await db.siteSetting.findUniqueOrThrow({ where: { key: keys[2] } })).value as { revision: string };
  const completionBinding = randomToken(); anon.set(oauthCookie, completionBinding);
  const pending = await db.oAuthAttempt.create({ data: { provider: "yandex", stateHash: hash(randomToken()), bindingHash: hash(completionBinding), configRevision: revision.revision, verifier: "", nonce: "", returnTo: "/account/", stage: "PROFILE", consent: { text: "Synthetic consent", version: "fixture" }, expiresAt: new Date(Date.now() + 600000) } }); ids.push(pending.id);
  await db.oAuthAttempt.update({ where: { id: pending.id }, data: { profile: encryptSecret(JSON.stringify({ subject: `qa-http-${tag}`, name: "Synthetic buyer", email: `social-http-${tag}@example.test` }), `oauth-profile:${pending.id}`) } });
  const completePath = "/login/social/?provider=yandex", complete = await form(completePath, 'name="privacyConsent"');
  complete.set("email", `social-http-${tag}@example.test`); complete.set("name", "Synthetic buyer");
  assert.match((await request(completePath, complete)).headers.get("location")!, /error=consent/);
  complete.set("privacyConsent", "on");
  assert.equal((await request(completePath, complete)).headers.get("location"), "/account/");
  const buyer = await db.user.findUniqueOrThrow({ where: { email: `social-http-${tag}@example.test` } }); buyerIds.push(buyer.id);
  assert.equal(buyer.passwordHash, "!social-only"); assert(anon.has("3dp_session")); assert(!anon.has(oauthCookie));
  const account = await db.socialAccount.findFirstOrThrow({ where: { userId: buyer.id } });
  const unlink = await form("/account/profile/", account.id); unlink.set("confirmation", "on");
  assert.match((await request("/account/profile/", unlink)).headers.get("location")!, /social=last/);
  const passwordForm = await form("/account/profile/", 'name="repeatPassword"'); passwordForm.set("password", "LocalSocialQA-2026"); passwordForm.set("repeatPassword", "LocalSocialQA-2026"); passwordForm.set("privacyConsent", "on");
  assert.match((await request("/account/profile/", passwordForm)).headers.get("location")!, /password-set/);
  const unlinkWithPassword = await form("/account/profile/", account.id); unlinkWithPassword.set("confirmation", "on"); unlinkWithPassword.set("password", "wrong-password");
  assert.match((await request("/account/profile/", unlinkWithPassword)).headers.get("location")!, /social=password/);
  unlinkWithPassword.set("password", "LocalSocialQA-2026"); assert.match((await request("/account/profile/", unlinkWithPassword)).headers.get("location")!, /social=removed/);
  assert.equal(await db.socialAccount.count({ where: { userId: buyer.id } }), 0);
  const exportResponse = await request("/api/account/personal-data/");
  assert.equal(exportResponse.status, 410); assert.equal(await exportResponse.text(), "");
  assert.equal((await request("/account/privacy/")).headers.get("location"), "/contacts/");
  // Confirm profile unlink revokes the social consent without the retired portal.
  assert.equal(await db.session.count({ where: { userId: buyer.id } }), 1);
  assert.equal(await db.privacyConsent.count({ where: { userId: buyer.id, purpose: { startsWith: "social:" }, revokedAt: null } }), 0);
  console.log("PASS: social admin-only configuration, encrypted/redacted keys, Google legal gate, explicit consent, PKCE redirect, browser-bound/canceled/replayed callbacks, onboarding UI and session, last-login protection, password setup and confirmed unlink over HTTP. No provider requests.");
} finally {
  const created = await db.user.findUnique({ where: { email: `social-http-${tag}@example.test` }, select: { id: true } });
  if (created && !buyerIds.includes(created.id)) buyerIds.push(created.id);
  await db.oAuthAttempt.deleteMany({ where: { id: { in: ids } } });
  await db.privacyConsent.deleteMany({ where: { userId: { in: buyerIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ action: { startsWith: "auth.social" }, id: { notIn: oldAudit } }, { action: "auth.password.set", entityId: { in: buyerIds } }] } });
  await db.user.deleteMany({ where: { id: { in: buyerIds } } });
  for (const key of keys) { const row = old.find(v => v.key === key); if (row) await db.siteSetting.upsert({ where: { key }, create: { key, group: row.group, value: row.value as Prisma.InputJsonValue }, update: { value: row.value as Prisma.InputJsonValue } }); else await db.siteSetting.deleteMany({ where: { key } }); }
  for (const key of operatorKeys) { const row = oldOperator.find(v => v.key === key); if (row) await db.siteSetting.upsert({ where: { key }, create: { key, group: row.group, value: row.value as Prisma.InputJsonValue }, update: { value: row.value as Prisma.InputJsonValue, group: row.group } }); else await db.siteSetting.deleteMany({ where: { key } }); }
  await db.$disconnect();
}
