import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/integration-secrets";
import type { FivePostConfig } from "./fivepost-config";

type Credentials = Pick<FivePostConfig, "environment" | "apiKey">;
const origins = { test: "https://api-preprod-omni.x5.ru", production: "https://api-omni.x5.ru" };

// The checkout server and worker share the provider's one-token-per-50-minutes limit.
async function accessToken(config: Credentials) {
  const credential = createHash("sha256").update(config.apiKey).digest("hex");
  const key = `integrations.fivepost-token.${config.environment}`;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(53415002)`;
    const row = await tx.siteSetting.findUnique({ where: { key } });
    const saved = z.object({ credential: z.string(), token: z.string(), expires: z.number() }).safeParse(row?.value);
    if (saved.success && saved.data.credential === credential && saved.data.expires > Date.now()) return decryptSecret(saved.data.token, key);
    const url = new URL("/jwt-generate-claims/rs256/1", origins[config.environment]);
    url.searchParams.set("apikey", config.apiKey);
    const response = await fetch(url, { method: "POST", body: new URLSearchParams({ subject: "OpenAPI", audience: "A122019!" }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("fivepost-authorization");
    const { jwt } = z.object({ status: z.literal("ok"), jwt: z.string().min(1).max(8000) }).parse(await response.json());
    const value = { credential, token: encryptSecret(jwt, key), expires: Date.now() + 55 * 60000 };
    await tx.siteSetting.upsert({ where: { key }, update: { value }, create: { key, group: "integrations", value } });
    return jwt;
  }, { timeout: 15000 });
}

export class FivePostClient {
  constructor(private config: Credentials, private token = accessToken) {}
  private async request(path: string, method: "GET" | "POST" | "DELETE", body?: unknown) {
    const jwt = await this.token(this.config);
    const response = await fetch(new URL(path, origins[this.config.environment]), {
      method, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error(`fivepost-http-${response.status}`);
    return response;
  }
  async warehouse(id: string) {
    const result = z.object({ id: z.guid(), type: z.literal("PARTNER_WAREHOUSE"), status: z.literal("ACTIVE"), partnerLocationId: z.string().min(1).max(255) })
      .parse(await (await this.request(`/api/v1/warehouse/${z.guid().parse(id)}`, "GET")).json());
    if (result.id.toLowerCase() !== id.toLowerCase()) throw new Error("fivepost-warehouse");
    return result.partnerLocationId;
  }
  async points(pageNumber: number, pageSize = 1000) {
    const response = await this.request("/api/v1/pickuppoints/query", "POST", { pageNumber, pageSize });
    return z.object({ content: z.array(z.unknown()).max(pageSize), totalPages: z.number().int().nonnegative() }).parse(await response.json());
  }
  async create(body: unknown, number: string) {
    const response = await this.request("/api/v3/orders", "POST", body);
    const result = z.array(z.object({ created: z.boolean(), senderOrderId: z.string(), orderId: z.guid().nullish() })).parse(await response.json());
    const match = result.find(row => row.senderOrderId === number);
    if (!match?.created || !match.orderId) throw new Error("fivepost-create-unconfirmed");
    return match.orderId;
  }
  async status(number: string) {
    const response = await this.request("/api/v1/getOrderStatus", "POST", [{ senderOrderId: number }]);
    const rows = z.array(z.object({ senderOrderId: z.string(), orderId: z.guid(), status: z.string().min(1), executionStatus: z.string(), changeDate: z.iso.datetime({ offset: true }) })).parse(await response.json());
    return rows.find(row => row.senderOrderId === number);
  }
  async cancel(id: string) {
    const response = await this.request(`/api/v2/cancelOrder/byOrderId/${z.guid().parse(id)}`, "DELETE");
    return z.object({ error: z.boolean(), canBeRetriedLater: z.boolean().optional() }).parse(await response.json());
  }
  async label(id: string) {
    const response = await this.request("/api/v1/orderLabels/byOrderId?format=PDF", "POST", { orderIds: [z.guid().parse(id)] });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 12_000_000 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("fivepost-label");
    return bytes;
  }
}
