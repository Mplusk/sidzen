import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { pointSearchTerms } from "../src/lib/delivery/point-search";
import { pointSearchSql } from "../src/lib/delivery/point-search-sql";

// Synthetic public addresses only. Refuse all production databases.
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const marker = `qa-point-index-${randomUUID()}`;
type Point = { id: string; address: string };
type Explain = { Plan: { "Index Name"?: string; Plans?: Explain["Plan"][] }; "Execution Time": number };
const hasIndex = (plan: Explain["Plan"]): boolean => plan["Index Name"] === "OzonDeliveryPoint_address_search_idx" || (plan.Plans || []).some(hasIndex);
async function search(query: string) {
  return prisma.$queryRaw<Point[]>(pointSearchSql(marker, 7n, pointSearchTerms(query), 9));
}
try {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "updatedAt")
    SELECT ${marker} || '-' || n, 'Synthetic pickup point',
      CASE WHEN n <= 8 THEN 'Россия, Яблоновский, улица Гагарина, ' || (189 + n) || '/2'
        ELSE 'Россия, Испытательный город, улица Проверочная, ' || n END,
      'pvz', true, ${marker}, 7, ${marker}, NOW()
    FROM generate_series(1, 100000) AS n
  `);
  await prisma.ozonDeliveryPoint.createMany({ data: [
    { id: marker + '-orel', name: "QA", address: "Россия, Орёл, Берёзовая, 20/2", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-hyphen', name: "QA", address: "Россия, Ростов-на-Дону, улица Южная, 80Б", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-omsk', name: "QA", address: "Россия, Омск, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-tomsk', name: "QA", address: "Россия, Томск, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-inactive', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: false, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-other-client', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: true, clientId: marker + '-other', methodId: 7n, generation: marker },
    { id: marker + '-other-method', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 8n, generation: marker },
  ] });
  await prisma.$executeRaw`ANALYZE "OzonDeliveryPoint"`;
  const expected = (await search("Яблоновский Гагарина")).map(point => point.id);
  assert.equal(expected.length, 8);
  for (const query of ["Яб", "гагар яблон", "ЯБЛОНОВСКИЙ, ГАГАРИНА", "Гагарина Яблоновский"]) {
    assert.deepEqual((await search(query)).map(point => point.id), expected, query);
    const result = await prisma.$queryRaw<[{ "QUERY PLAN": Explain[] }]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${pointSearchSql(marker, 7n, pointSearchTerms(query), 9)}`);
    const plan = result[0]["QUERY PLAN"][0];
    assert(hasIndex(plan.Plan), "Selective prefix searches must use the actual migration index, not scan 100,000 addresses");
    console.log(JSON.stringify({ query, indexed: true, executionMs: plan["Execution Time"], fixtureRows: 100007 }));
  }
  assert.deepEqual((await search("Яблоновский 19")), []);
  assert.equal((await search("яблон 190/2"))[0]?.id, marker + "-1");
  assert.equal((await search("берез орел 20/2"))[0]?.id, marker + "-orel");
  assert.deepEqual((await search("омск")).map(point => point.id), [marker + "-omsk"]);
  assert.equal((await search("Дон ростов 80"))[0]?.id, marker + "-hyphen");
  // GIN expression indexes follow updates/deactivation automatically: no stale cache.
  await prisma.ozonDeliveryPoint.update({ where: { id: marker + "-1" }, data: { active: false } });
  assert.equal((await search("яблон 190/2")).length, 0);
  await prisma.ozonDeliveryPoint.update({ where: { id: marker + "-2" }, data: { address: "Россия, Орёл, Берёзовая, 191/2" } });
  assert.equal((await search("яблон 191/2")).length, 0);
  assert.equal((await search("орел 191/2"))[0]?.id, marker + "-2");
  console.log("PASS: indexed prefix lookup on 100,000 synthetic addresses, unchanged word/house matching, scope, ё/е, hyphens, updates and deactivation. No provider calls or customer data.");
} finally {
  await prisma.ozonDeliveryPoint.deleteMany({ where: { generation: marker, clientId: { in: [marker, marker + "-other"] } } });
  await prisma.$executeRaw`ANALYZE "OzonDeliveryPoint"`;
  await prisma.$disconnect();
}
