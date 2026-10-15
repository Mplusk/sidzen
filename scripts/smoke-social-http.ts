// Verify retired social-login UI and existing-account compatibility in local QA only.
// No external provider is contacted and no real customer account is changed.
import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import { encryptSecret } from "../src/lib/integration-secrets";
import { hash, randomToken } from "../src/lib/social/flow";
import { verifyPassword } from "../src/lib/password";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const db = new PrismaClient(), admin = new Map<string, string>(), buyerJar = new Map<string, string>();
const keys = ["auth.social.google", "auth.social.vk", "auth.social.yandex"];
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const previous = await db.siteSetting.findMany({ where: { key: { in: [...keys, ...operatorKeys] } } });
const tag = randomToken().slice(0, 8).toLowerCase();
const buyerEmail = `social-http-${tag}@example.test`;
let buyerId: string | undefined;
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');

async function request(path: string, body?: FormData, jar = buyerJar) {
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET", redirect: "manual", body,
    // Isolate this fixture's login bucket from the other sequential HTTP suites.
    headers: { "x-forwarded-for": "198.51.100.78", Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body ? { Origin: base.origin } : {}) },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0], at = pair.indexOf("=");
    if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
    else jar.delete(pair.slice(0, at));
  }
  return response;
}

async function form(path: string, contains: string, jar = buyerJar) {
  const response = await request(path, undefined, jar); assert.equal(response.status, 200);
  const html = await response.text();
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(match => match.includes(contains));
  assert(markup, `Missing form: ${contains}`);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] ?? "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(decode(name), decode(value));
  }
  return body;
}

function noSocialControls(html: string) {
  assert.doesNotMatch(html, /Или через другой аккаунт|Подключить способ входа|Способы входа|Вход через Google, ВКонтакте и Яндекс|Соцаккаунты не подключены/);
  assert.doesNotMatch(html, /name="socialConsent"|id="social-login"|class="social-login/);
  assert.doesNotMatch(html, /<input\b[^>]*name="provider"[^>]*value="(?:google|vk|yandex)"/);
  assert(!html.includes("qa-social-secret-never-public"));
}

try {
  for (const [key, value] of [["legal.seller", "Synthetic QA operator"], ["legal.address", "Synthetic QA address"], ["contacts.email", "operator@example.test"]]) {
    await db.siteSetting.upsert({ where: { key }, create: { key, group: "qa", value }, update: { value } });
  }
  // Buttons must stay absent even if all providers were configured previously.
  for (const [index, key] of keys.entries()) {
    const value = {
      enabled: true, operatorReviewed: true, revision: tag,
      clientId: ["123456-fixture.apps.googleusercontent.com", "12345678", "b".repeat(32)][index],
      clientSecret: index === 1 ? "" : encryptSecret("qa-social-secret-never-public", key),
    };
    await db.siteSetting.upsert({ where: { key }, create: { key, group: "integrations", value }, update: { value } });
  }
  for (const path of ["/login/", "/register/"]) {
    const response = await request(path); assert.equal(response.status, 200);
    const html = await response.text(); noSocialControls(html);
    assert.match(html, /name="email"/); assert.match(html, /name="password"/);
  }
  assert.match((await request("/account/profile/")).headers.get("location")!, /login/);
  assert.match((await request("/account/integrations/")).headers.get("location")!, /login/);

  const login = await form("/login/", 'name="email"', admin);
  login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login, admin)).headers.get("location"), "/account/");
  for (const path of ["/account/profile/", "/account/integrations/"]) {
    const response = await request(path, undefined, admin); assert.equal(response.status, 200);
    const html = await response.text(); noSocialControls(html);
    if (path.includes("integrations")) {
      assert.match(html, /id="communications"/);
      assert.match(html, /DeepSeek/); assert.match(html, /Telegram/); assert.match(html, /Ozon/);
    } else assert.doesNotMatch(html, /name="repeatPassword"/);
  }

  const buyer = await db.user.create({ data: { email: buyerEmail, name: "Synthetic buyer", passwordHash: "!social-only" } });
  buyerId = buyer.id;
  await db.socialAccount.create({ data: { userId: buyer.id, provider: "vk", clientId: "12345678", subject: `qa-${tag}` } });
  const session = randomToken(); buyerJar.set("3dp_session", session);
  await db.session.create({ data: { userId: buyer.id, tokenHash: hash(session), expiresAt: new Date(Date.now() + 600000) } });
  const profile = await (await request("/account/profile/")).text(); noSocialControls(profile);
  assert.match(profile, /Пароль для входа/);
  assert.doesNotMatch(profile, /Соцаккаунт|ВКонтакте|привязк/);
  const passwordForm = await form("/account/profile/", 'name="repeatPassword"');
  passwordForm.set("password", "LocalSocialQA-2026"); passwordForm.set("repeatPassword", "different-password"); passwordForm.set("privacyConsent", "on");
  assert.match((await request("/account/profile/", passwordForm)).headers.get("location")!, /social=password$/);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).passwordHash, "!social-only");
  passwordForm.set("repeatPassword", "LocalSocialQA-2026");
  assert.match((await request("/account/profile/", passwordForm)).headers.get("location")!, /password-set/);
  assert(verifyPassword("LocalSocialQA-2026", (await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).passwordHash));
  assert.equal(await db.socialAccount.count({ where: { userId: buyer.id } }), 1, "Existing identity records must not be deleted");
  const updatedProfile = await (await request("/account/profile/")).text(); noSocialControls(updatedProfile);
  assert.doesNotMatch(updatedProfile, /name="repeatPassword"/);

  const freshSession = new Map<string, string>();
  const ordinaryLogin = await form("/login/?returnTo=%2Faccount%2Fprofile%2F", 'name="email"', freshSession);
  ordinaryLogin.set("email", buyerEmail); ordinaryLogin.set("password", "LocalSocialQA-2026");
  assert.equal((await request("/login/", ordinaryLogin, freshSession)).headers.get("location"), "/account/profile/");
  assert(freshSession.has("3dp_session"));
  console.log("PASS: no social controls on login, registration, customer/admin profiles or integrations with configured providers; email/password login, safe password setup and existing identities preserved. No provider requests.");
} finally {
  if (buyerId) {
    await db.privacyConsent.deleteMany({ where: { userId: buyerId } });
    await db.auditLog.deleteMany({ where: { actorId: buyerId } });
    await db.user.delete({ where: { id: buyerId } });
  }
  for (const key of [...keys, ...operatorKeys]) {
    const row = previous.find(value => value.key === key);
    if (row) await db.siteSetting.upsert({ where: { key }, create: { key, group: row.group, value: row.value as Prisma.InputJsonValue }, update: { group: row.group, value: row.value as Prisma.InputJsonValue } });
    else await db.siteSetting.deleteMany({ where: { key } });
  }
  await db.$disconnect();
}
