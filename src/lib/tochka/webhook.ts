import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";

let cachedKey: { key: KeyObject; expires: number } | undefined;
export async function verifyTochkaWebhook(jwt: string) {
  if (jwt.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) throw new Error("webhook-format");
  const [header, body, signature] = jwt.split(".");
  const parsed = z.object({ alg: z.literal("RS256"), crit: z.never().optional() }).parse(JSON.parse(Buffer.from(header, "base64url").toString("utf8")));
  if (parsed.alg !== "RS256") throw new Error("webhook-algorithm");
  if (!cachedKey || cachedKey.expires <= Date.now()) {
    try {
      const response = await fetch("https://enter.tochka.com/doc/openapi/static/keys/public", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("webhook-key-unavailable");
      const jwk = z.object({ kty: z.literal("RSA"), n: z.string().min(100), e: z.string().min(1) }).parse(await response.json());
      cachedKey = { key: createPublicKey({ key: jwk, format: "jwk" }), expires: Date.now() + 15 * 60 * 1000 };
    } catch { throw new Error("webhook-key-unavailable"); }
  }
  if (!verify("RSA-SHA256", Buffer.from(`${header}.${body}`), cachedKey.key, Buffer.from(signature, "base64url"))) throw new Error("webhook-signature");
  const claims = z.object({ webhookType: z.string(), operationId: z.string().max(100).optional(), paymentLinkId: z.string().max(45).optional(), customerCode: z.string().optional(), merchantId: z.string().optional(), exp: z.number().optional(), nbf: z.number().optional() }).parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if ((claims.exp !== undefined && claims.exp * 1000 < Date.now()) || (claims.nbf !== undefined && claims.nbf * 1000 > Date.now() + 60000)) throw new Error("webhook-expired");
  return claims;
}

export async function readWebhookBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 32768) throw new Error("webhook-too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("webhook-format");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new Error("webhook-too-large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8").trim();
}
