import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OzonDeliveryClient, OzonDeliveryError, type OzonCheckoutRequest } from "./ozon-client";
import { OZON_QUOTE_BUDGET_MS, retryOzonQuote } from "./ozon-retry";

const credentials = { clientId: "fixture", clientSecret: "synthetic-secret" };
const request: OzonCheckoutRequest = { recipient: { phone_number: "+79991234567" }, delivery: { delivery_point: { delivery_point_id: 42 } }, postings: [{ request_id: 1, shipment_method_id: 7, cutoff_at: "2030-01-01T12:00:00Z", declared_value: { amount: "240.00", currency_code: "RUB" }, dimensions: { weight_g: 100, length_mm: 200, width_mm: 100, height_mm: 50 } }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const quote = () => json({ results: [{ request_id: 1, posting: { estimated_delivery_cost: { amount: "100.00", currency_code: "RUB" }, estimated_insurance_cost: { amount: "2.00", currency_code: "RUB" }, estimated_delivery_days: 3, cutoff_at: request.postings[0].cutoff_at } }] });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("bounded quote-only Ozon retries", () => {
  it("recovers after an OAuth network failure without waiting for another click", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("private raw error"))
      .mockResolvedValueOnce(json({ access_token: "fixture-token" })).mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(quote());
    vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request));
    await vi.advanceTimersByTimeAsync(499); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ value: { cost: 102, days: 3 }, attempts: 2 });
    expect(fetcher.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(["/oauth/token", "/oauth/token", "/v1/delivery/check-client", "/v1/order/checkout"]);
  });
  for (const status of [502, 503, 504]) it(`recovers after HTTP ${status}, reuses token, preserves parcel input`, async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "fixture-token" }))
      .mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(json({ private: "not logged" }, status))
      .mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(quote());
    vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request)); await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ attempts: 2 });
    expect(fetcher.mock.calls.filter(call => String(call[0]).endsWith("/oauth/token"))).toHaveLength(1);
    expect(fetcher.mock.calls[2][1]!.body).toBe(fetcher.mock.calls[4][1]!.body);
    expect(JSON.parse(fetcher.mock.calls[4][1]!.body as string)).toEqual(request);
  });
  it("uses at most three attempts and reports exhaustion without raw data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-secret +79991234567")); vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request));
    const assertion = expect(pending).rejects.toMatchObject({ code: "transport", message: "transport", attempts: 3 });
    await vi.advanceTimersByTimeAsync(1500); await assertion; expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("recovers an empty HTTP-200 quote without another click and never creates a shipment", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" }))
      .mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(quote());
    vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request)); await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ value: { cost: 102, days: 3 }, attempts: 2 });
    expect(fetcher.mock.calls[2][1]!.body).toBe(fetcher.mock.calls[4][1]!.body);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("/create"))).toBe(true);
  });
  it("stops incomplete quotes after three attempts and does not retry explicit restrictions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => json(String(url).endsWith("/oauth/token") ? {access_token: "token"} : String(url).endsWith("/check-client") ? {can_be_delivered: true} : {results: []}));
    vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request));
    const assertion = expect(pending).rejects.toMatchObject({ attempts: 3, checkoutFailure: "empty-results", receivedParcels: 0, expectedParcels: 1 });
    await vi.advanceTimersByTimeAsync(1500); await assertion;
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/checkout"))).toHaveLength(3);
    fetcher.mockReset().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(json({ results: [{request_id: 1, error: {code: "DeliveryPointRestrictionsError"}}] }));
    await expect(retryOzonQuote(credentials, api => api.checkout(request))).rejects.toMatchObject({attempts: 1, checkoutFailure: "point-restrictions"});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  for (const status of [400, 401, 403, 429, 500]) it(`does not retry HTTP ${status}`, async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, status)); vi.stubGlobal("fetch", fetcher);
    await expect(retryOzonQuote(credentials, api => api.checkout(request))).rejects.toMatchObject({ attempts: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry an unregistered recipient or invalid JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: false })); vi.stubGlobal("fetch", fetcher);
    await expect(retryOzonQuote(credentials, api => api.checkout(request))).rejects.toMatchObject({ code: "recipient", attempts: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockClear().mockResolvedValue(new Response("invalid-json"));
    await expect(retryOzonQuote(credentials, api => api.checkout(request))).rejects.toMatchObject({ code: "response", attempts: 1 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries a network failure while reading a response body", async () => {
    const broken = json({}); vi.spyOn(broken, "json").mockRejectedValue(new TypeError("private interrupted body"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(broken).mockResolvedValueOnce(json({ access_token: "token" })).mockResolvedValueOnce(json({ can_be_delivered: true })).mockResolvedValueOnce(quote()); vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, api => api.checkout(request)); await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ attempts: 2 });
  });
  it("shares the 45 second budget across retries and caps each request at 15 seconds", async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      timeouts.push(milliseconds); const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds); return controller.signal;
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("timeout")), { once: true })));
    vi.stubGlobal("fetch", fetcher);
    const started = Date.now(); const pending = retryOzonQuote(credentials, api => api.checkout(request));
    const assertion = expect(pending).rejects.toMatchObject({ code: "transport", attempts: 3 });
    await vi.advanceTimersByTimeAsync(OZON_QUOTE_BUDGET_MS); await assertion;
    expect(Date.now() - started).toBe(45_000); expect(timeouts).toEqual([15_000, 15_000, 13_500]); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not start a new network request after the budget was spent across successful calls", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 9_000)); return json({ access_token: "token" }); }); vi.stubGlobal("fetch", fetcher);
    const pending = retryOzonQuote(credentials, async api => { for (let i = 0; i < 6; i++) await api.authorize(); });
    const assertion = expect(pending).rejects.toMatchObject({ code: "transport", attempts: 1 });
    await vi.advanceTimersByTimeAsync(45_000); await assertion;
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("forbids shipment mutations inside the retry client, and leaves the normal client single-attempt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("ambiguous timeout")); vi.stubGlobal("fetch", fetcher);
    for (const path of ["/v1/order/create", "/v1/order/cancel", "/v1/posting/cancel"]) await expect(retryOzonQuote(credentials, api => api.json(path, {}))).rejects.toMatchObject({ code: "path", attempts: 1 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new OzonDeliveryClient(credentials).json("/v1/order/create", {})).rejects.toBeInstanceOf(OzonDeliveryError); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
