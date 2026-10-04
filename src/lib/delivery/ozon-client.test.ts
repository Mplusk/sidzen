import { afterEach, describe, expect, it, vi } from "vitest";
import { OzonDeliveryClient, OZON_DELIVERY_SCOPES, type OzonCheckoutRequest } from "./ozon-client";

afterEach(() => vi.restoreAllMocks());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const request: OzonCheckoutRequest = { recipient: { phone_number: "+79991234567" }, delivery: { delivery_point: { delivery_point_id: 42 } }, postings: [{ request_id: 1, shipment_method_id: 7, cutoff_at: "2030-01-01T12:00:00Z", declared_value: { amount: "240.00", currency_code: "RUB" }, dimensions: { weight_g: 100, length_mm: 200, width_mm: 100, height_mm: 50 } }] };
describe("official Ozon Delivery API client", () => {
  it("discovers existing methods without creating routes and guards repeating pagination", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ shipment_methods: [{ shipment_method_id: 7, name: "Метод 1", status: "active" }], next_cursor: "page-2" })).mockResolvedValueOnce(json({ shipment_methods: [{ shipment_method_id: 8, name: "Метод 2", status: "blocked" }], next_cursor: null }));
    const api = new OzonDeliveryClient({ clientId: "app", clientSecret: "synthetic-secret" }, transport);
    expect(await api.shipmentMethods()).toHaveLength(2);
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string)).toEqual({ pagination: { cursor: null, limit: 100 } });
    expect(JSON.parse(transport.mock.calls[2][1]!.body as string)).toEqual({ pagination: { cursor: "page-2", limit: 100 } });
    const repeating = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockImplementation(async () => json({ shipment_methods: [], next_cursor: "same" }));
    await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, repeating).shipmentMethods()).rejects.toThrow("pagination");
  });
  it("uses separate client credentials with a JSON scope array and Bearer authorization", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "synthetic-token" })).mockResolvedValueOnce(json({ shipment_methods: [{ shipment_method_id: 7, name: "Наш пункт отгрузки", status: "active" }] }));
    const api = new OzonDeliveryClient({ clientId: "private-app", clientSecret: "synthetic-secret" }, transport);
    expect(await api.verifyMethod(7)).toMatchObject({ name: "Наш пункт отгрузки" });
    expect(transport.mock.calls[0][0]).toBe("https://xapi.ozon.ru/oauth/token");
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({ client_id: "private-app", client_secret: "synthetic-secret", grant_type: "client_credentials", scope: OZON_DELIVERY_SCOPES });
    expect(transport.mock.calls[1][0]).toBe("https://api-delivery.ozon.ru/v1/shipment-method/info");
    expect(transport.mock.calls[1][1]!.headers).toMatchObject({ Authorization: "Bearer synthetic-token" });
  });
  it("repeats a testcookie redirect as POST, preserves UUID/body and separates host cookies", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: "/oauth/token?__rr=1", "Set-Cookie": "auth-cookie=example; Path=/" } })).mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "/v1/order/create?__rr=1", "Set-Cookie": "api-cookie=example; Path=/" } })).mockResolvedValueOnce(json({ order_number: "test-only" }));
    const api = new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport);
    await api.json("/v1/order/create", { test: true }, { "Idempotency-Key": "00000000-0000-4000-8000-000000000001" });
    expect(transport.mock.calls[1][1]!.headers).toMatchObject({ Cookie: "auth-cookie=example" });
    expect(transport.mock.calls[2][1]!.headers).not.toHaveProperty("Cookie");
    expect(transport.mock.calls[3][1]).toMatchObject({ method: "POST", body: '{"test":true}', headers: { Cookie: "api-cookie=example", "Idempotency-Key": "00000000-0000-4000-8000-000000000001" } });
  });
  it("refuses redirects that could leak credentials, change operations or loop", async () => {
    for (const location of ["https://evil.example/oauth/token", "http://xapi.ozon.ru/oauth/token", "/other-operation", "https://user:secret@xapi.ozon.ru/oauth/token"]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { Location: location } }));
      await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport).authorize()).rejects.toThrow("redirect");
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const loop = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "/oauth/token?__rr=1" } }));
    await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, loop).authorize()).rejects.toThrow("redirect");
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it("includes real delivery and insurance cost and validates every parcel", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(json({ results: [{ request_id: 1, posting: { estimated_delivery_cost: { amount: "123.45", currency_code: "RUB" }, estimated_insurance_cost: { amount: "2.55", currency_code: "RUB" }, estimated_delivery_days: 3, cutoff_at: request.postings[0].cutoff_at } }] }));
    const api = new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport);
    expect(await api.checkout(request)).toEqual({ cost: 126, days: 3 });
    expect(transport.mock.calls[2][0]).toBe("https://api-delivery.ozon.ru/v1/order/checkout");
    expect(JSON.parse(transport.mock.calls[2][1]!.body as string)).toEqual(request);
  });
  it("rejects an unregistered recipient without calculating or creating delivery", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: false }));
    await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport).checkout(request)).rejects.toThrow("recipient");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never treats a partial, duplicate or errored quote as free delivery", async () => {
    for (const results of [[], [{ request_id: 1, error: { code: "DeliveryPointRestrictionsError" } }], [{ request_id: 2, posting: {} }], [{ request_id: 1 }, { request_id: 1 }]]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(json({ results }));
      await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport).checkout(request)).rejects.toThrow();
    }
  });
  it("starts pagination with null, not an empty cursor, and accepts only active methods", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ delivery_points: [], next_cursor: null })).mockResolvedValueOnce(json({ shipment_methods: [{ shipment_method_id: 7, name: "Test", status: "blocked" }] }));
    const api = new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport);
    await api.pointPage(null);
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string)).toEqual({ pagination: { cursor: null, limit: 100 } });
    await expect(api.verifyMethod(7)).rejects.toThrow("method");
  });
  it("returns sanitized errors without credentials or buyer data", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ secret: "must-not-appear", buyer: "must-not-appear" }, 403));
    await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, transport).authorize()).rejects.toThrow("credentials");
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic-secret"));
    await expect(new OzonDeliveryClient({ clientId: "app", clientSecret: "secret" }, failed).authorize()).rejects.toThrow("transport");
  });
});
