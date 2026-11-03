import { z } from "zod";

/** Client for CDEK's documented OAuth and delivery methods. */
export class CdekDeliveryError extends Error {
  constructor(public readonly code: "credentials" | "transport" | "rate" | "provider" | "response" | "not-found") {
    super(code);
  }
}

type Environment = "test" | "production";
type QueryValue = string | number | boolean;
export type CdekPackage = { weight: number; length: number; width: number; height: number };
export type CdekTariffQuery = { type: 1 | 2; from_location: { code: number }; to_location: { code: number }; shipment_point: string; delivery_point: string; packages: CdekPackage[] };

export class CdekDeliveryClient {
  private token?: string;
  private readonly origin: string;

  constructor(
    private readonly credentials: { clientId: string; clientSecret: string },
    environment: Environment,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.origin = environment === "test" ? "https://api.edu.cdek.ru" : "https://api.cdek.ru";
  }

  private async request(path: string, options: RequestInit, detectMissingOrder = false): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`${this.origin}${path}`, {
        ...options, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      });
    } catch { throw new CdekDeliveryError("transport"); }
    if (!response.ok) {
      if (detectMissingOrder && response.status === 400) {
        try {
          const value = z.object({ requests: z.array(z.object({ errors: z.array(z.object({ code: z.string() })).optional() })).optional() }).parse(await response.json());
          if (value.requests?.some(entry => entry.errors?.some(error => error.code === "v2_entity_not_found"))) throw new CdekDeliveryError("not-found");
        } catch (error) { if (error instanceof CdekDeliveryError) throw error; }
      }
      await response.body?.cancel().catch(() => undefined);
      throw new CdekDeliveryError(response.status === 401 || response.status === 403 ? "credentials" : response.status === 429 ? "rate" : "provider");
    }
    try { return await response.json(); } catch { throw new CdekDeliveryError("response"); }
  }

  async authorize(): Promise<void> {
    if (this.token) return;
    if (!this.credentials.clientId || !this.credentials.clientSecret) throw new CdekDeliveryError("credentials");
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret });
    const result = z.object({ access_token: z.string().min(1) }).safeParse(await this.request("/v2/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }));
    if (!result.success) throw new CdekDeliveryError("response");
    this.token = result.data.access_token;
  }

  private async get(path: "/v2/location/suggest/cities" | "/v2/deliverypoints", params: Record<string, QueryValue>): Promise<unknown> {
    if (!this.token) await this.authorize();
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
    return this.request(`${path}?${query}`, { method: "GET", headers: { Authorization: `Bearer ${this.token}` } });
  }

  suggestCities(name: string) {
    return this.get("/v2/location/suggest/cities", { name, country_code: "RU" });
  }

  deliveryPointsPage(cityCode: number, page: number) {
    if (!Number.isSafeInteger(cityCode) || cityCode <= 0 || !Number.isSafeInteger(page) || page < 0) throw new CdekDeliveryError("response");
    return this.get("/v2/deliverypoints", { city_code: cityCode, is_handout: true, size: 1000, page });
  }

  deliveryPoint(code: string, parcel?: CdekPackage) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(code)) throw new CdekDeliveryError("response");
    return this.get("/v2/deliverypoints", { code, ...(parcel ? { weight_max: Math.ceil(parcel.weight / 1000), length: parcel.length, width: parcel.width, height: parcel.height } : {}) });
  }

  async tariffList(query: CdekTariffQuery): Promise<unknown> {
    if (!this.token) await this.authorize();
    return this.request("/v2/calculator/tarifflist", { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(query) });
  }

  async tariff(query: CdekTariffQuery & { tariff_code: number }): Promise<unknown> {
    if (!this.token) await this.authorize();
    return this.request("/v2/calculator/tariff", { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(query) });
  }

  async createOrder(body: unknown): Promise<unknown> {
    if (!this.token) await this.authorize();
    return this.request("/v2/orders", { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async order(remoteId: string): Promise<unknown> {
    if (!z.uuid().safeParse(remoteId).success) throw new CdekDeliveryError("response");
    if (!this.token) await this.authorize();
    return this.request(`/v2/orders/${remoteId}`, { method: "GET", headers: { Authorization: `Bearer ${this.token}` } }, true);
  }

  async deleteOrder(remoteId: string): Promise<unknown> {
    if (!z.uuid().safeParse(remoteId).success) throw new CdekDeliveryError("response");
    if (!this.token) await this.authorize();
    return this.request(`/v2/orders/${remoteId}`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
  }
}
