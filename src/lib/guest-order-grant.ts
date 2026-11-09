import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export const GUEST_GRANT_SECONDS = 30 * 24 * 60 * 60;
type GrantDb = PrismaClient | Prisma.TransactionClient;
type GuestOrder = { number: string; userId: string | null; createdAt: Date; personalDataErasedAt?: Date | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function guestOrderSignature(number: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", process.env.AUTH_SECRET).update(`order:${number}`).digest("hex");
}

export function validGuestOrderGrant(number: string, value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(guestOrderSignature(number), "hex"));
}

/** Create with the order transaction so a committed order has a usable grant. */
export async function createGuestGrant(db: GrantDb, orderNumber: string) {
  const token = `v2.${randomBytes(32).toString("base64url")}`;
  await db.guestOrderGrant.create({ data: { tokenHash: digest(token), orderNumber, expiresAt: new Date(Date.now() + GUEST_GRANT_SECONDS * 1000) } });
  return token;
}

export async function guestGrantAllows(db: GrantDb, order: GuestOrder, value: string, now = new Date()) {
  if (order.userId || order.personalDataErasedAt || !value) return false;
  const record = await db.guestOrderGrant.findUnique({ where: { tokenHash: digest(value) } });
  if (record) return record.orderNumber === order.number && !record.revokedAt && record.expiresAt > now;
  // Existing browser grants have no embedded expiration. Honor only the
  // original 30-day window measured from creation, never indefinitely.
  return validGuestOrderGrant(order.number, value) && order.createdAt.getTime() <= now.getTime() && now.getTime() - order.createdAt.getTime() < GUEST_GRANT_SECONDS * 1000;
}

/** Revoke all issued grants, including legacy signatures if ownership changes. */
export async function revokeGuestGrantsForOrder(db: GrantDb, orderNumber: string) {
  const now = new Date();
  await db.guestOrderGrant.updateMany({ where: { orderNumber, revokedAt: null }, data: { revokedAt: now } });
  const tokenHash = digest(guestOrderSignature(orderNumber));
  await db.guestOrderGrant.upsert({ where: { tokenHash }, create: { tokenHash, orderNumber, expiresAt: now, revokedAt: now }, update: { revokedAt: now } });
}

/** Logout must revoke a copied grant as well as deleting the browser cookie. */
export async function revokeGuestGrant(db: GrantDb, orderNumber: string, value: string) {
  if (!value || (!/^v2\.[A-Za-z0-9_-]{43}$/.test(value) && !validGuestOrderGrant(orderNumber, value))) return;
  const now = new Date();
  const tokenHash = digest(value);
  if (validGuestOrderGrant(orderNumber, value)) {
    await db.guestOrderGrant.upsert({ where: { tokenHash }, create: { tokenHash, orderNumber, expiresAt: now, revokedAt: now }, update: { revokedAt: now } });
  } else await db.guestOrderGrant.updateMany({ where: { tokenHash, orderNumber, revokedAt: null }, data: { revokedAt: now } });
}
