import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCloudConfig } from "./config";
import { safeReceiptUrl } from "./client";
import { cents, receiptMatches } from "./payload";
import { readFiscalPayload } from "./lifecycle";

export function verifyCloudHmac(body: string, signature: string | null, secret: string) {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const supplied = Buffer.from(signature, "base64");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
export async function readCloudBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 64 * 1024) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 64 * 1024) { await reader.cancel(); throw new Error("size"); } chunks.push(chunk.value); }
  return Buffer.concat(chunks).toString("utf8");
}
const text = z.string().min(1).max(100);
const notificationSchema = z.object({ Id: text, InvoiceId: text, Inn: z.string(), Type: z.enum(["Income", "IncomeReturn"]), Amount: z.string(), Url: z.string().optional(), Receipt: z.string(), DocumentNumber: text, FiscalSign: text, FiscalNumber: text, RegNumber: text, DateTime: text });
export async function acceptCloudNotification(raw: string, signature: string | null) {
  const config = await getCloudConfig();
  if (!verifyCloudHmac(raw, signature, config.apiSecret)) throw new Error("signature");
  const params = new URLSearchParams(raw);
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new Error("duplicate");
  const event = notificationSchema.parse(Object.fromEntries(params));
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const current = await getCloudConfig(tx);
    if (current.publicId !== config.publicId || current.apiSecret !== config.apiSecret) throw new Error("configuration");
    const row = await tx.fiscalReceipt.findUnique({ where: { id: event.InvoiceId } });
    if (!row) return; // Other services sharing a terminal do not mutate our orders.
    if (!row.firstAttemptAt || row.publicId !== config.publicId || row.inn !== event.Inn || cents(event.Amount) !== cents(row.amount) || (row.externalId && row.externalId !== event.Id)) throw new Error("binding");
    const expected = readFiscalPayload(row);
    if (event.Type !== expected.Type || !receiptMatches(JSON.parse(event.Receipt), expected.CustomerReceipt)) throw new Error("binding");
    await tx.fiscalReceipt.update({ where: { id: row.id }, data: { status: "PROCESSED", externalId: event.Id, receiptUrl: safeReceiptUrl(event.Url) ?? row.receiptUrl, leaseUntil: null, errorCode: null, processedAt: row.processedAt ?? new Date(), fiscalData: { documentNumber: event.DocumentNumber, fiscalSign: event.FiscalSign, fiscalNumber: event.FiscalNumber, regNumber: event.RegNumber, issuedAt: event.DateTime } } });
  });
}
