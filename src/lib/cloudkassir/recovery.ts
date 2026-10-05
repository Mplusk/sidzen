import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cloudConfigured, getCloudConfig } from "./config";
import { cloudRequest, safeReceiptUrl } from "./client";
import { readFiscalPayload } from "./lifecycle";
import { cents, receiptMatches } from "./payload";

// Recovery is READ ONLY at the provider. It never resets the idempotency key
// or creates a replacement receipt after an ambiguous/failed submission.
export async function recoverFiscalReceipt(receiptId: string, externalId: string, actorId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(externalId)) throw new Error("receipt-id");
  const [row, config] = await Promise.all([prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: receiptId } }), getCloudConfig()]);
  if (!row.firstAttemptAt || !cloudConfigured(config) || row.publicId !== config.publicId || row.inn !== config.inn || (row.externalId && row.externalId !== externalId)) throw new Error("receipt-binding");
  if (await cloudRequest(config, "kkt/receipt/status/get", { Id: externalId }) !== "Processed") throw new Error("receipt-unprocessed");
  const raw = await cloudRequest(config, "kkt/receipt/get", { Id: externalId });
  const model = z.object({ AdditionalData: z.object({ Id: z.string(), InvoiceId: z.string(), OrganizationInn: z.string(), Amount: z.number(), Type: z.string(), OfdReceiptUrl: z.string().nullish(), DocumentNumber: z.union([z.string(), z.number()]), FiscalSign: z.union([z.string(), z.number()]), FiscalNumber: z.string(), RegNumber: z.string(), DateTime: z.string() }) }).parse(raw);
  const data = model.AdditionalData;
  const expected = readFiscalPayload(row);
  if (data.Id !== externalId || data.InvoiceId !== row.id || data.OrganizationInn !== row.inn || data.Type !== expected.Type || cents(data.Amount) !== cents(row.amount) || !receiptMatches(raw, expected.CustomerReceipt)) throw new Error("receipt-binding");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const currentConfig = await getCloudConfig(tx);
    if (currentConfig.publicId !== config.publicId || currentConfig.apiSecret !== config.apiSecret) throw new Error("receipt-config-changed");
    const updated = await tx.fiscalReceipt.updateMany({ where: { id: row.id, OR: [{ externalId: null }, { externalId }] }, data: { externalId, status: "PROCESSED", receiptUrl: safeReceiptUrl(data.OfdReceiptUrl) ?? `https://receipts.ru/${encodeURIComponent(externalId)}`, leaseUntil: null, errorCode: null, processedAt: row.processedAt ?? new Date(), fiscalData: { documentNumber: String(data.DocumentNumber), fiscalSign: String(data.FiscalSign), fiscalNumber: data.FiscalNumber, regNumber: data.RegNumber, issuedAt: data.DateTime } } });
    if (!updated.count) throw new Error("receipt-binding");
    await tx.auditLog.create({ data: { actorId, action: "fiscal.receipt.reconcile", entityType: "FiscalReceipt", entityId: row.id, after: { externalId, status: "PROCESSED" } } });
  });
}
