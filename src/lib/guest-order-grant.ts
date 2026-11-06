import { createHmac, timingSafeEqual } from "node:crypto";

export function guestOrderSignature(number: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", process.env.AUTH_SECRET).update(`order:${number}`).digest("hex");
}

export function validGuestOrderGrant(number: string, value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(guestOrderSignature(number), "hex"));
}
