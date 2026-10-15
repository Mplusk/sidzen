import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ClientRow = { id: string; name: string | null; phone: string | null; email: string; createdAt: Date; source: "ACCOUNT" | "ORDER" };

// This is an internal contact directory, NOT account registration or ownership
// verification. Never update User/Order.userId or grant login/order access here.
const directory = Prisma.sql`
  WITH accounts AS (
    SELECT u."id", u."name", u."phone", u."email", u."createdAt",
      lower(trim(u."email")) AS email_key,
      regexp_replace(coalesce(u."phone", ''), '[^0-9]', '', 'g') AS digits
    FROM "User" u
  ), account_contacts AS (
    SELECT *, CASE WHEN length(digits) = 11 AND left(digits, 1) = '8' THEN '7' || substr(digits, 2) ELSE digits END AS phone_key
    FROM accounts
  ), order_contacts AS (
    SELECT o."id", o."userId", o."customerName", o."customerEmail", o."customerPhone", o."createdAt",
      lower(trim(o."customerEmail")) AS email_key,
      regexp_replace(o."customerPhone", '[^0-9]', '', 'g') AS digits
    FROM "Order" o WHERE o."deletedAt" IS NULL AND o."personalDataErasedAt" IS NULL
  ), contacts AS (
    SELECT *, CASE WHEN length(digits) = 11 AND left(digits, 1) = '8' THEN '7' || substr(digits, 2) ELSE digits END AS phone_key
    FROM order_contacts
  ), guests AS (
    SELECT c.*, CASE WHEN c.email_key <> '' AND c.phone_key <> ''
      THEN json_build_array(c.email_key, c.phone_key)::text ELSE c."id" END AS contact_key
    FROM contacts c WHERE c."userId" IS NULL AND NOT EXISTS (
      SELECT 1 FROM account_contacts a WHERE c.email_key <> '' AND c.phone_key <> ''
        AND a.email_key = c.email_key AND a.phone_key = c.phone_key
    )
  ), clients AS (
    SELECT 'account:' || a."id" AS id,
      coalesce(nullif(trim(a."name"), ''), nullif(trim(latest."customerName"), '')) AS name,
      coalesce(nullif(trim(a."phone"), ''), nullif(trim(latest."customerPhone"), '')) AS phone,
      a."email" AS email, a."createdAt", 'ACCOUNT'::text AS source
    FROM account_contacts a LEFT JOIN LATERAL (
      SELECT c."customerName", c."customerPhone" FROM contacts c WHERE c."userId" = a."id"
      ORDER BY c."createdAt" DESC, c."id" DESC LIMIT 1
    ) latest ON true
    UNION ALL
    SELECT 'order:' || encode(sha256(convert_to(g.contact_key, 'UTF8')), 'hex'), g."customerName", g."customerPhone", g."customerEmail", g.first_seen, 'ORDER'::text
    FROM (
      SELECT DISTINCT ON (contact_key) *, min("createdAt") OVER (PARTITION BY contact_key) AS first_seen
      FROM guests ORDER BY contact_key, "createdAt" DESC, "id" DESC
    ) g
  )
`;

/** Resolves the same full-pair guest grouping as the directory; never email alone. */
export async function clientErasureTarget(tx: Prisma.TransactionClient, key: string) {
  const [client] = await tx.$queryRaw<ClientRow[]>(Prisma.sql`${directory} SELECT id, name, phone, email, "createdAt", source FROM clients WHERE id = ${key} LIMIT 1`);
  if (!client) return null;
  const userId = key.startsWith("account:") ? key.slice(8) : null;
  const guestOrders = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`${directory}, erasure_contacts AS (
    SELECT o."id", o."userId", lower(trim(o."customerEmail")) AS email_key,
      CASE WHEN length(regexp_replace(o."customerPhone", '[^0-9]', '', 'g')) = 11 AND left(regexp_replace(o."customerPhone", '[^0-9]', '', 'g'), 1) = '8'
      THEN '7' || substr(regexp_replace(o."customerPhone", '[^0-9]', '', 'g'), 2) ELSE regexp_replace(o."customerPhone", '[^0-9]', '', 'g') END AS phone_key
    FROM "Order" o WHERE o."personalDataErasedAt" IS NULL
  ) SELECT c."id" FROM erasure_contacts c WHERE c."userId" IS NULL AND (
      ${userId === null} AND 'order:' || encode(sha256(convert_to(CASE WHEN c.email_key <> '' AND c.phone_key <> '' THEN json_build_array(c.email_key, c.phone_key)::text ELSE c."id" END, 'UTF8')), 'hex') = ${key}
      OR ${userId !== null} AND EXISTS (SELECT 1 FROM account_contacts a WHERE a."id" = ${userId} AND a.email_key <> '' AND a.phone_key <> '' AND a.email_key = c.email_key AND a.phone_key = c.phone_key)
    )`);
  return { userId, guestOrderIds: guestOrders.map(row => row.id) };
}

/** Call only AFTER checking customers.read. Each page reads one consistent snapshot. */
export async function getClientsPage(requested = 1, archived = false) {
  return prisma.$transaction(async tx => {
    const filter = Prisma.sql`EXISTS (SELECT 1 FROM "ClientArchive" a WHERE a."key" = clients.id) = ${archived}`;
    const [{ total }] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${directory} SELECT count(*)::int AS total FROM clients WHERE ${filter}`);
    const pages = Math.max(1, Math.ceil(total / 50));
    const page = Number.isFinite(requested) ? Math.min(pages, Math.max(1, Math.floor(requested))) : 1;
    const clients = await tx.$queryRaw<ClientRow[]>(Prisma.sql`${directory}
      SELECT id, name, phone, email, "createdAt", source FROM clients WHERE ${filter}
      ORDER BY "createdAt" DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}
    `);
    return { clients, total, pages, page };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** No account/order/payment mutations. The audit stores only a digest, not contacts. */
export async function setClientArchived(key: string, archived: boolean, actorId: string) {
  const { createHash } = await import("node:crypto");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412029)`;
    const [client] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`${directory} SELECT id FROM clients WHERE id = ${key} LIMIT 1`);
    if (!client) return false;
    const existing = await tx.clientArchive.findUnique({ where: { key }, select: { key: true } });
    if (Boolean(existing) === archived) return true;
    if (archived) await tx.clientArchive.create({ data: { key } });
    else await tx.clientArchive.delete({ where: { key } });
    await tx.auditLog.create({ data: { actorId, action: archived ? "client.archive" : "client.restore", entityType: "Client", entityId: createHash("sha256").update(key).digest("hex"), after: { archived } } });
    return true;
  });
}
