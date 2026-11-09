import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Use a disposable schema in the local QA database, never a shop database.
const connection = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1", "::1", "[::1]"].includes(connection.hostname) && connection.pathname === "/shop_qa");
const schema = `seed_qa_${randomUUID().replaceAll("-", "")}`;
assert(/^seed_qa_[a-f0-9]{32}$/.test(schema));
const adminDb = new PrismaClient();
connection.searchParams.set("schema", schema);
const url = connection.toString();
const db = new PrismaClient({ datasources: { db: { url } } });
const env = { ...process.env, DATABASE_URL: url, BOOTSTRAP_ADMIN_EMAIL: "seed-qa@example.test", BOOTSTRAP_ADMIN_PASSWORD: "Local-seed-QA-only-2026" };
const run = (args: string[]) => execFileSync(process.execPath, args, { env, stdio: "pipe" });

try {
  await adminDb.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);

  // A fresh installation still receives its first owner, access rules and content.
  assert(await db.user.findUnique({ where: { email: "seed-qa@example.test" } }));
  assert(await db.role.findUnique({ where: { code: "superadmin" } }));
  const article = await db.article.findUniqueOrThrow({ where: { slug: "pla-ili-petg" } });
  assert.equal(article.status, "PUBLISHED");
  assert(await db.seoPage.findUnique({ where: { path: "/" } }));
  assert(await db.seoPage.findUnique({ where: { path: "/catalog/" } }));

  await db.rubric.update({ where: { slug: "guides" }, data: { name: "QA редакторская рубрика" } });
  await db.article.update({ where: { id: article.id }, data: { title: "QA заголовок", content: "QA текст", metaTitle: "QA метаданные", status: "DRAFT" } });
  for (const path of ["/", "/catalog/"]) {
    await db.seoPage.update({ where: { path }, data: { title: `QA title ${path}`, metaDescription: `QA description ${path}`, h1: `QA heading ${path}` } });
  }

  run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
  assert.equal((await db.rubric.findUniqueOrThrow({ where: { slug: "guides" } })).name, "QA редакторская рубрика");
  const after = await db.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.deepEqual([after.title, after.content, after.metaTitle, after.status], ["QA заголовок", "QA текст", "QA метаданные", "DRAFT"]);
  for (const path of ["/", "/catalog/"]) {
    const page = await db.seoPage.findUniqueOrThrow({ where: { path } });
    assert.deepEqual([page.title, page.metaDescription, page.h1], [`QA title ${path}`, `QA description ${path}`, `QA heading ${path}`]);
  }
  assert.equal(await db.user.count({ where: { email: "seed-qa@example.test" } }), 1);
  console.log("PASS: initial seed creates owner, permissions and content; repeated deployment seed preserves editorial SEO, rubric and draft article.");
} finally {
  await db.$disconnect();
  await adminDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminDb.$disconnect();
}
