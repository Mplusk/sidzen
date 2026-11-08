import { Prisma } from "@prisma/client";
import { pointSearchPattern, pointSearchQuery } from "./point-search";

export function pointSearchSql(clientId: string, methodId: bigint, terms: string[], limit: number, offset = 0) {
  // The indexed expression must stay identical to the migration. Explicit
  // Cyrillic folding works even in databases created with a C locale.
  return Prisma.sql`
    WITH directory AS (
      SELECT *, translate(lower("address"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе') AS normalized
      FROM "OzonDeliveryPoint"
      WHERE "clientId" = ${clientId} AND "methodId" = ${methodId} AND "active" = true
        AND to_tsvector('simple'::regconfig, regexp_replace(translate(lower("address"), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'), '[^[:alnum:]а-я]+', ' ', 'g'))
          @@ to_tsquery('simple'::regconfig, ${pointSearchQuery(terms)})
    )
    SELECT "id", "name", "address", "type", "latitude", "longitude" FROM directory
    WHERE ${Prisma.join(terms.map(term => Prisma.sql`normalized ~ ${pointSearchPattern(term)}`), " AND ")}
    ORDER BY (${Prisma.join(terms.map(term => Prisma.sql`CASE WHEN normalized ~ ${pointSearchPattern(term, true)} THEN 0 ELSE 1 END`), " + ")}) ASC,
      (${Prisma.join(terms.map(term => Prisma.sql`strpos(normalized, ${term})`), " + ")}) ASC, "address" ASC, "id" ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}
