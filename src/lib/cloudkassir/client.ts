import { z } from "zod";
import type { CloudConfig } from "./config";

export async function cloudRequest(config: Pick<CloudConfig, "publicId" | "apiSecret">, path: "test" | "kkt/state/get" | "kkt/receipt" | "kkt/receipt/status/get" | "kkt/receipt/get", body: object = {}, requestId?: string) {
  if (!config.publicId || !config.apiSecret) throw new Error("cloud-credentials");
  const response = await fetch(`https://api.cloudpayments.ru/${path}`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Basic ${Buffer.from(`${config.publicId}:${config.apiSecret}`).toString("base64")}`, "Content-Type": "application/json", ...(requestId ? { "X-Request-ID": requestId } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`cloud-http-${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("cloud-response");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 128 * 1024) { await reader.cancel(); throw new Error("cloud-response-size"); } chunks.push(next.value); }
  const raw = Buffer.concat(chunks).toString("utf8");
  // Provider messages may contain personal data; never surface or log them.
  const parsed = z.object({ Success: z.boolean(), Model: z.unknown().optional() }).parse(JSON.parse(raw));
  if (!parsed.Success) throw new Error("cloud-rejected");
  return parsed.Model;
}
export async function checkCloud(config: CloudConfig) {
  await cloudRequest(config, "test");
  const state = z.object({ Inn: z.string(), DeviceNumber: z.string(), FiscalNumber: z.string(), Status: z.number(), Fiscal: z.boolean(), IsBso: z.boolean(), IsReceiptProcessingBlocked: z.boolean().optional(), FiscalDateEnd: z.string(), CalculationPlace: z.string() }).parse(await cloudRequest(config, "kkt/state/get", { DeviceNumber: config.deviceNumber, FiscalNumber: config.fiscalNumber }));
  const normalize = (value: string) => value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (state.Inn !== config.inn || state.DeviceNumber !== config.deviceNumber || state.FiscalNumber !== config.fiscalNumber || state.Status !== 1 || !state.Fiscal || state.IsBso || state.IsReceiptProcessingBlocked || !(Date.parse(state.FiscalDateEnd) > Date.now()) || normalize(state.CalculationPlace) !== "sidzen.shop") throw new Error("cloud-cashbox");
}
export function safeReceiptUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "receipts.ru" || url.hostname === "receipts.cloudpayments.ru") ? url.href : null;
  } catch { return null; }
}
