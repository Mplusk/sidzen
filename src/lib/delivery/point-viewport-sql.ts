import { Prisma } from "@prisma/client";
import { MAX_VIEWPORT_POINTS, VIEWPORT_GRID_SIZE, normalizePickupCity, pickupCityPattern, type PickupViewport } from "./point-viewport";
import { pointSearchQuery, pointSearchTerms } from "./point-search";

export function pickupCitySql(clientId: string, methodId: bigint, search: string) {
  const pattern = pickupCityPattern(search);
  if (!pattern) throw new Error("Invalid pickup city");
  return Prisma.sql`
    SELECT "latitude", "longitude" FROM "OzonDeliveryPoint"
    WHERE "clientId" = ${clientId} AND "methodId" = ${methodId} AND "active" = true
      AND "latitude" BETWEEN -85.051128 AND 85.051128 AND "longitude" BETWEEN -180 AND 180
      AND NOT ("latitude" = 0 AND "longitude" = 0)
      AND to_tsvector('simple'::regconfig, regexp_replace(translate(lower("address"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'), '[^[:alnum:]а-я]+', ' ', 'g'))
        @@ to_tsquery('simple'::regconfig, ${pointSearchQuery(pointSearchTerms(normalizePickupCity(search)))})
      AND translate(lower("address"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе') ~ ${pattern}
    ORDER BY "latitude", "longitude", "id"
  `;
}

// PostgreSQL returns at most 500 points or 20 x 20 compact cells. All matching
// points contribute: no arbitrary first-page cutoff and no full city payload.
export function pickupViewportSql(clientId: string, methodId: bigint, viewport: PickupViewport, offset = 0) {
  const { south, west, north, east } = viewport.bounds;
  // Coincident provider coordinates cannot be separated by zooming any further.
  // The explicit final-zoom list uses bounded pages, rather than hiding these
  // points permanently in an unexpandable cluster.
  if (viewport.zoom === 18) return Prisma.sql`
    SELECT "id", 1::integer AS count, "latitude", "longitude", "latitude" AS south, "longitude" AS west,
      "latitude" AS north, "longitude" AS east, "name", "address", "type"
    FROM "OzonDeliveryPoint"
    WHERE "clientId" = ${clientId} AND "methodId" = ${methodId} AND "active" = true
      AND "latitude" BETWEEN ${south} AND ${north} AND "longitude" BETWEEN ${west} AND ${east}
      AND NOT ("latitude" = 0 AND "longitude" = 0)
    ORDER BY "id" ASC LIMIT ${MAX_VIEWPORT_POINTS + 1} OFFSET ${offset}
  `;
  return Prisma.sql`
    WITH visible AS MATERIALIZED (
      SELECT "id", "latitude", "longitude" FROM "OzonDeliveryPoint"
      WHERE "clientId" = ${clientId} AND "methodId" = ${methodId} AND "active" = true
        AND "latitude" BETWEEN ${south} AND ${north} AND "longitude" BETWEEN ${west} AND ${east}
        AND NOT ("latitude" = 0 AND "longitude" = 0)
    ), cells AS (
      SELECT *, CASE WHEN (SELECT count(*) FROM visible) <= ${MAX_VIEWPORT_POINTS} THEN "id"
        ELSE concat(
          LEAST(${VIEWPORT_GRID_SIZE - 1}, floor(("longitude" - ${west}) / ${east - west} * ${VIEWPORT_GRID_SIZE})::integer), ':',
          LEAST(${VIEWPORT_GRID_SIZE - 1}, floor(("latitude" - ${south}) / ${north - south} * ${VIEWPORT_GRID_SIZE})::integer)
        ) END AS cell FROM visible
    ), grouped AS (
      SELECT min("id") AS id, count(*)::integer AS count, avg("latitude") AS latitude, avg("longitude") AS longitude,
        min("latitude") AS south, min("longitude") AS west, max("latitude") AS north, max("longitude") AS east
      FROM cells GROUP BY cell
    )
    SELECT g.*, p."name", p."address", p."type" FROM grouped g
    LEFT JOIN "OzonDeliveryPoint" p ON g.count = 1 AND p."id" = g.id
    ORDER BY g.id
  `;
}
