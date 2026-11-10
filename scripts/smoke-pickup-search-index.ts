import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { pointSearchTerms } from "../src/lib/delivery/point-search";
import { pointSearchSql } from "../src/lib/delivery/point-search-sql";
import { pickupCitySql, pickupViewportSql } from "../src/lib/delivery/point-viewport-sql";
import { pickupCityOverview, pickupViewportResult, type PickupViewportRow } from "../src/lib/delivery/point-viewport";

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
  // A large city must not send 10,000 addresses before the map can open.
  // Only coordinates are read for the overview; viewports aggregate in SQL.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "latitude", "longitude", "updatedAt")
    SELECT ${marker} || '-moscow-' || n, 'Synthetic map point', 'Россия, Москва г., улица Проверочная, ' || n,
      'pvz', true, ${marker}, 7, ${marker}, 55.55 + (n % 100) * 0.004, 37.3 + (n / 100) * 0.006, NOW()
    FROM generate_series(0, 9999) AS n
  `);
  await prisma.ozonDeliveryPoint.createMany({ data: [
    { id: marker + '-city-tambov', name: "QA", address: "Россия, Тамбов, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.72, longitude: 41.44 },
    { id: marker + '-prefix-tambov', name: "QA", address: "Россия, г.Тамбов, улица Ленина, 2", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.73, longitude: 41.45 },
    { id: marker + '-suffix-petersburg', name: "QA", address: "Россия, Санкт-Петербург г., улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 59.9, longitude: 30.3 },
    { id: marker + '-street-tambov', name: "QA", address: "Россия, Омск, улица Тамбовская, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 55, longitude: 73.37 },
    { id: marker + '-region-tambov', name: "QA", address: "Россия, Тамбовская область, Мичуринск, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.9, longitude: 40.49 },
    { id: marker + '-foreign-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: true, clientId: marker + '-other', methodId: 7n, generation: marker, latitude: 55.7, longitude: 37.5 },
    { id: marker + '-inactive-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: false, clientId: marker, methodId: 7n, generation: marker, latitude: 55.7, longitude: 37.5 },
    { id: marker + '-method-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 8n, generation: marker, latitude: 55.7, longitude: 37.5 },
  ] });
  const cityCoordinates = await prisma.$queryRaw<Array<{ latitude: number; longitude: number }>>(pickupCitySql(marker, 7n, "Москва"));
  assert.equal(cityCoordinates.length, 10000);
  const overview = pickupCityOverview("Москва", cityCoordinates);
  assert(overview && JSON.stringify(overview).length < 250);
  assert(overview.bounds.north - overview.bounds.south > 0.3);
  assert(overview.bounds.east - overview.bounds.west > 0.4);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Тамбов")), [{ latitude: 52.72, longitude: 41.44 }, { latitude: 52.73, longitude: 41.45 }]);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Санкт-Петербург")), [{ latitude: 59.9, longitude: 30.3 }]);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Табмов")), []);
  const broad = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: { south: 55.5, west: 37.2, north: 56, east: 38 }, zoom: 10 }));
  assert(broad.length <= 400 && broad.length > 0);
  assert.equal(broad.reduce((sum, feature) => sum + feature.count, 0), 10000);
  const payload = pickupViewportResult(broad, "qa");
  assert(payload.clusters.length > 0 && JSON.stringify(payload).length < 100000);
  const district = async (south: number, west: number, north: number, east: number) => {
    const features = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: { south, west, north, east }, zoom: 15 }));
    const expected = await prisma.ozonDeliveryPoint.count({ where: { clientId: marker, methodId: 7n, active: true, latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } });
    assert(expected > 0 && expected <= 500);
    assert.equal(features.length, expected);
    assert(features.every(feature => feature.count === 1 && feature.address && feature.latitude >= south && feature.latitude <= north && feature.longitude >= west && feature.longitude <= east));
    return features;
  };
  const southwest = await district(55.55, 37.3, 55.59, 37.36);
  const northeast = await district(55.9, 37.8, 55.946, 37.894);
  assert(!southwest.some(point => northeast.some(other => point.id === other.id)));
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "latitude", "longitude", "updatedAt")
    SELECT ${marker} || '-coincident-' || n, 'Synthetic coincident point', 'Россия, Москва, улица Совпадающая, ' || n,
      'pvz', true, ${marker}, 7, ${marker}, 55.7011, 37.5011, NOW()
    FROM generate_series(0, 649) AS n
  `);
  const tiny = { bounds: { south: 55.701, west: 37.501, north: 55.7012, east: 37.5012 }, zoom: 18 };
  const firstPage = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, tiny));
  const lastPage = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, tiny, 500));
  assert.equal(firstPage.length, 501); assert.equal(lastPage.length, 150);
  assert.equal(new Set([...firstPage.slice(0, 500), ...lastPage].map(point => point.id)).size, 650);
  assert([...firstPage, ...lastPage].every(point => point.count === 1 && point.address));
  console.log("PASS: compact Moscow overview, complete server cluster coverage of 10,000 points, district zoom/pan, exact city matching, and integration scope.");
  console.log("PASS: indexed prefix lookup on 100,000 synthetic addresses, unchanged word/house matching, scope, ё/е, hyphens, updates and deactivation. No provider calls or customer data.");
} finally {
  await prisma.ozonDeliveryPoint.deleteMany({ where: { generation: marker, clientId: { in: [marker, marker + "-other"] } } });
  await prisma.$executeRaw`ANALYZE "OzonDeliveryPoint"`;
  await prisma.$disconnect();
}
