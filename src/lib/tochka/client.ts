import { z } from "zod";
import type { TochkaConfig } from "./config";
import { validProductionToken } from "./config";

const money = z.union([z.number(), z.string()]).refine(value => Number.isFinite(Number(value)) && Number(value) > 0);
export const operationSchema = z.object({
  operationId: z.string().min(1).max(100), amount: money,
  status: z.enum(["CREATED", "APPROVED", "ON-REFUND", "REFUNDED", "EXPIRED", "REFUNDED_PARTIALLY", "AUTHORIZED", "WAIT_FULL_PAYMENT"]),
  customerCode: z.string(), merchantId: z.string().optional(), paymentLinkId: z.string().optional(),
  paymentLink: z.url(), preAuthorization: z.boolean().optional(),
});
export type TochkaOperation = z.infer<typeof operationSchema>;

export async function tochkaRequest(config: Pick<TochkaConfig, "token">, path: string, body?: object) {
  if (!validProductionToken(config.token)) throw new Error("tochka-token");
  const response = await fetch(`https://enter.tochka.com/uapi/${path}`, {
    method: body ? "POST" : "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Do not expose bank responses (which can contain buyer data or credentials).
  if (!response.ok) throw new Error(`tochka-api-${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function checkTochka(config: TochkaConfig) {
  const customers = z.object({ Data: z.object({ Customer: z.array(z.object({ customerCode: z.string(), customerType: z.string() })) }) }).parse(await tochkaRequest(config, "open-banking/v1.0/customers"));
  if (!customers.Data.Customer.some(item => item.customerCode === config.customerCode && item.customerType === "Business")) throw new Error("tochka-customer");
  const retailers = z.object({ Data: z.object({ Retailer: z.array(z.object({ merchantId: z.string().optional(), status: z.string(), isActive: z.boolean(), paymentModes: z.array(z.string()), cashbox: z.string().optional() })) }) }).parse(await tochkaRequest(config, `acquiring/v1.0/retailers?customerCode=${encodeURIComponent(config.customerCode)}`));
  const retailer = retailers.Data.Retailer.find(item => item.merchantId === config.merchantId);
  if (!retailer || retailer.status !== "REG" || !retailer.isActive || (config.card && !retailer.paymentModes.includes("card")) || (config.sbp && !retailer.paymentModes.includes("sbp"))) throw new Error("tochka-merchant");
  if (config.receiptMode === "provider" && !retailer.cashbox) throw new Error("tochka-cashbox");
  // Also verify ReadAcquiringData without creating a payment or transmitting buyer data.
  const today = new Date().toISOString().slice(0, 10);
  z.object({ Data: z.object({ Operation: z.array(z.unknown()) }) }).parse(await tochkaRequest(config, `acquiring/v1.0/payments?customerCode=${encodeURIComponent(config.customerCode)}&fromDate=${today}&toDate=${today}&perPage=1`));
}

export async function getTochkaOperation(config: TochkaConfig, id: string) {
  const result = z.object({ Data: z.object({ Operation: z.array(operationSchema) }) }).parse(await tochkaRequest(config, `acquiring/v1.0/payments/${encodeURIComponent(id)}`));
  const operation = result.Data.Operation.find(item => item.operationId === id);
  if (!operation) throw new Error("tochka-operation-missing");
  return operation;
}

// Links come only from an authenticated bank response, never from submitted form data.
// The API does not guarantee a fixed hostname for the bank's payment processor.
export function tochkaPaymentUrl(operation: TochkaOperation) {
  if (operation.status !== "CREATED" && operation.status !== "WAIT_FULL_PAYMENT") return null;
  const url = new URL(operation.paymentLink);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new Error("tochka-payment-url");
  return url.href;
}
