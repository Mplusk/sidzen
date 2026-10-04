import { z } from "zod";

// Official contract: https://docs.ozon.ru/api/ozon-delivery/
export const OZON_DELIVERY_SCOPES = ["delivery-api.shipment-method", "delivery-api.delivery", "delivery-api.delivery-point", "delivery-api.order", "delivery-api.posting"];
export const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const pointCoordinatesSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) });
export const shipmentMethodSchema = z.object({ shipment_method_id: positiveId, name: z.string().max(500), status: z.string().max(80) });
const money = z.object({ amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/), currency_code: z.literal("RUB") });
export const parcelSchema = z.object({ weight_g: z.number().int().positive().max(1_000_000), length_mm: z.number().int().positive().max(10_000), width_mm: z.number().int().positive().max(10_000), height_mm: z.number().int().positive().max(10_000) });
export const postingSchema = z.object({ request_id: positiveId, shipment_method_id: positiveId, cutoff_at: z.iso.datetime(), declared_value: money, dimensions: parcelSchema });
export const checkoutRequestSchema = z.object({ recipient: z.object({ phone_number: z.string().regex(/^\+7\d{10}$/) }), delivery: z.object({ delivery_point: z.object({ delivery_point_id: positiveId }) }), postings: z.array(postingSchema).min(1).max(100) });
export type OzonCheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export class OzonDeliveryError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export class OzonDeliveryClient {
  private cookies = new Map<string, Map<string, string>>();
  private token?: string;
  constructor(private credentials: { clientId: string; clientSecret: string }, private transport: typeof fetch = fetch) {}

  private async request(url: string, body: unknown, authorization?: string, extra: Record<string, string> = {}) {
    const origin = new URL(url).origin;
    const jar = this.cookies.get(origin) ?? new Map<string, string>();
    this.cookies.set(origin, jar);
    for (let redirects = 0; redirects < 4; redirects++) {
      let response: Response;
      try {
        response = await this.transport(url, { method: "POST", body: JSON.stringify(body), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json", ...extra, ...(authorization ? { Authorization: authorization } : {}), ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) } });
      } catch { throw new OzonDeliveryError("transport"); }
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0]; const at = pair.indexOf("=");
        if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      if (response.status === 302 || response.status === 307) {
        const location = response.headers.get("location");
        if (!location) throw new OzonDeliveryError("redirect");
        const next = new URL(location, url);
        if (next.origin !== origin || next.protocol !== "https:" || next.username || next.password || next.pathname !== new URL(url).pathname) throw new OzonDeliveryError("redirect");
        url = next.href;
        continue; // Documented testcookie handshake: retain POST body and cookies.
      }
      if (!response.ok) throw new OzonDeliveryError(response.status === 401 || response.status === 403 ? "credentials" : response.status === 429 ? "rate" : "provider");
      return response;
    }
    throw new OzonDeliveryError("redirect");
  }

  async authorize() {
    if (!this.credentials.clientId || !this.credentials.clientSecret) throw new OzonDeliveryError("credentials");
    const response = await this.request("https://xapi.ozon.ru/oauth/token", { client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, grant_type: "client_credentials", scope: OZON_DELIVERY_SCOPES });
    const result = z.object({ access_token: z.string().min(1) }).safeParse(await response.json());
    if (!result.success) throw new OzonDeliveryError("response");
    this.token = result.data.access_token;
  }

  async call(path: string, body: unknown, extra?: Record<string, string>) {
    if (!/^\/v1\/[a-z-]+\/[a-z-]+$/.test(path)) throw new OzonDeliveryError("path");
    if (!this.token) await this.authorize();
    return this.request(`https://api-delivery.ozon.ru${path}`, body, `Bearer ${this.token}`, extra);
  }
  async json(path: string, body: unknown, extra?: Record<string, string>): Promise<unknown> { return (await this.call(path, body, extra)).json(); }

  async verifyMethod(id: number) {
    const result = z.object({ shipment_methods: z.array(z.object({ shipment_method_id: positiveId, name: z.string(), status: z.string() })) }).parse(await this.json("/v1/shipment-method/info", { shipment_method_ids: [id] }));
    const method = result.shipment_methods.find(value => value.shipment_method_id === id);
    if (!method || method.status !== "active") throw new OzonDeliveryError("method");
    return method;
  }
  async shipmentMethods() {
    const methods = new Map<number, z.infer<typeof shipmentMethodSchema>>();
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const response = z.object({ shipment_methods: z.array(shipmentMethodSchema), next_cursor: z.string().nullish() }).parse(await this.json("/v1/shipment-method/search", { pagination: { cursor, limit: 100 } }));
      for (const method of response.shipment_methods) methods.set(method.shipment_method_id, method);
      if (!response.next_cursor) return [...methods.values()];
      if (seen.has(response.next_cursor)) throw new OzonDeliveryError("pagination");
      seen.add(response.next_cursor); cursor = response.next_cursor;
    }
    throw new OzonDeliveryError("pagination");
  }
  async pointInfo(ids: number[]) {
    return z.object({ delivery_points: z.array(z.object({ delivery_point_id: positiveId, name: z.string(), full_address: z.string(), is_active: z.boolean(), type: z.string(), coordinates: pointCoordinatesSchema.nullish() })) }).parse(await this.json("/v1/delivery-point/info", { delivery_point_ids: ids })).delivery_points;
  }
  async pointPage(cursor: string | null) {
    return z.object({ delivery_points: z.array(z.object({ delivery_point_id: positiveId, shipment_method_ids: z.union([z.array(positiveId), positiveId]) })), next_cursor: z.string().nullish() }).parse(await this.json("/v1/delivery-point/list", { pagination: { cursor, limit: 100 } }));
  }
  async checkout(request: OzonCheckoutRequest) {
    const allowed = z.object({ can_be_delivered: z.boolean() }).parse(await this.json("/v1/delivery/check-client", { phone_number: request.recipient.phone_number }));
    if (!allowed.can_be_delivered) throw new OzonDeliveryError("recipient");
    const response = z.object({ results: z.array(z.object({ request_id: positiveId, posting: z.object({ estimated_delivery_cost: money, estimated_insurance_cost: money, estimated_delivery_days: z.number().int().nonnegative(), cutoff_at: z.iso.datetime() }).nullish(), error: z.unknown().optional() })) }).parse(await this.json("/v1/order/checkout", checkoutRequestSchema.parse(request)));
    if (response.results.length !== request.postings.length || new Set(response.results.map(row => row.request_id)).size !== request.postings.length) throw new OzonDeliveryError("unavailable");
    let cost = 0; let days = 0;
    for (const posting of request.postings) {
      const row = response.results.find(result => result.request_id === posting.request_id);
      if (!row?.posting || row.error != null) throw new OzonDeliveryError("unavailable");
      cost += Math.round(Number(row.posting.estimated_delivery_cost.amount) * 100) + Math.round(Number(row.posting.estimated_insurance_cost.amount) * 100);
      days = Math.max(days, row.posting.estimated_delivery_days);
    }
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > 99_999_900) throw new OzonDeliveryError("response");
    return { cost: cost / 100, days };
  }
}
