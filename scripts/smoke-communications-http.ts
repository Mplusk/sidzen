import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { TELEGRAM_KEY } from "../src/lib/telegram/config";
import { REVIEW_AI_KEY } from "../src/lib/review-ai/config";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const keys = [TELEGRAM_KEY, REVIEW_AI_KEY], original = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
const actor = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } }), roles = await prisma.userRole.findMany({ where: { userId: actor.id } });
const jar = new Map<string, string>(), path = "/account/integrations/", token = "123456789:fixture-token-must-not-appear";
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
async function request(target: string, body?: FormData, auth = true, origin = base.origin) {
  const response = await fetch(new URL(target, base), { method: body ? "POST" : "GET", body, redirect: "manual", headers: { ...(auth ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) } });
  if (auth) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
  return response;
}
async function form(target: string, needle: string) {
  const response = await request(target); assert.equal(response.status, 200);
  const html = await response.text(), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(text => text.includes(needle)); assert(markup);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) { const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(decode(name), decode(value)); }
  return { body, html };
}
try {
  const stored = { enabled: false, token: encryptSecret(token, TELEGRAM_KEY), chatId: "123456789", checkedAt: null, revision: randomUUID() };
  await prisma.siteSetting.upsert({ where: { key: TELEGRAM_KEY }, create: { key: TELEGRAM_KEY, group: "integrations", value: stored }, update: { value: stored } });
  const login = (await form("/login/", 'name="email"')).body; login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026"); assert.equal((await request("/login/", login)).status, 303);
  const telegram = await form(path, 'name="chatId"');
  assert(telegram.html.includes("Telegram · уведомления о новых заказах")); assert(telegram.html.includes("DeepSeek · модерация отзывов"));
  assert(!telegram.html.includes(token) && !telegram.html.includes(stored.token));
  telegram.body.set("chatId", "@not-a-numeric-chat");
  assert.match((await request(path, telegram.body, false)).headers.get("location") ?? "", /login/);
  assert((await request(path, telegram.body, true, "https://foreign.invalid")).status >= 400);
  try { await prisma.userRole.deleteMany({ where: { userId: actor.id } }); assert.match((await request(path, telegram.body)).headers.get("location") ?? "", /forbidden/); }
  finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  assert.match((await request(path, telegram.body)).headers.get("location") ?? "", /telegram-invalid/);
  assert.deepEqual((await prisma.siteSetting.findUniqueOrThrow({ where: { key: TELEGRAM_KEY } })).value, stored);
  telegram.body.set("chatId", "123456789");
  assert.match((await request(path, telegram.body)).headers.get("location") ?? "", /telegram-saved/);
  const changed = (await prisma.siteSetting.findUniqueOrThrow({ where: { key: TELEGRAM_KEY } })).value as { token: string; enabled: boolean };
  assert(changed.token.startsWith("v1.") && changed.token !== token && !changed.enabled);
  assert.match((await request(path, telegram.body)).headers.get("location") ?? "", /communications-changed/);
  const review = await form(path, 'Включить автоматическую модерацию DeepSeek');
  review.body.set("enabled", "on"); review.body.delete("operatorReviewed");
  assert.match((await request(path, review.body)).headers.get("location") ?? "", /review-ai-incomplete/);
  review.body.delete("enabled"); assert.match((await request(path, review.body)).headers.get("location") ?? "", /review-ai-saved/);
  assert.match((await request("/admin/order-alert/nonexistent/", undefined, false)).headers.get("location") ?? "", /login/);
  assert.equal((await request("/admin/order-alert/nonexistent/")).status, 404);
  const consent = await (await request("/legal/consent/?purpose=review-ai", undefined, false)).text(); assert(consent.includes("Добровольное согласие") && consent.includes("Китай"));
  const catalog = await (await request("/catalog/", undefined, false)).text();
  assert(!catalog.includes("<h3>Магазин</h3>")); assert(catalog.includes('href="/delivery/"'));
  console.log("PASS: real HTTP action auth/permission/CSRF, encrypted Telegram configuration, hidden secrets, revision guard, review AI operator confirmation, private alert route and footer.");
} finally {
  await prisma.userRole.createMany({ data: roles, skipDuplicates: true });
  await prisma.siteSetting.deleteMany({ where: { key: { in: keys } } });
  for (const row of original) await prisma.siteSetting.create({ data: { ...row, value: row.value ?? Prisma.JsonNull } });
  await prisma.$disconnect();
}
