import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), transaction: vi.fn(), shipment: vi.fn(), config: vi.fn(), json: vi.fn(), call: vi.fn(), privacy: vi.fn() }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: vi.fn() }));
vi.mock("@/lib/privacy", () => ({ operatorReady: mocks.privacy }));
vi.mock("@/lib/prisma", () => ({ prisma: { ozonDeliveryJob: { findFirst: mocks.find, updateMany: mocks.claim }, $transaction: mocks.transaction } }));
vi.mock("./ozon-config", () => ({ getOzonDeliveryConfig: mocks.config }));
vi.mock("./ozon-client", async importOriginal => {
  const original = await importOriginal<typeof import("./ozon-client")>();
  return { ...original, OzonDeliveryClient: class { json = mocks.json; call = mocks.call; } };
});
import { cancelOzonJob, ozonCreateBody, processOzonJob, refreshOzonJob } from "./ozon-worker";

it("preserves the quoted declared value in the shipment body", () => {
  const posting = { request_id: 1, shipment_method_id: 7, cutoff_at: "2030-01-01T12:00:00Z", declared_value: { amount: "3500.00", currency_code: "RUB" }, dimensions: { weight_g: 500, length_mm: 300, width_mm: 200, height_mm: 200 } };
  const result = ozonCreateBody({ recipient: { phone_number: "+79991234567" }, delivery: { delivery_point: { delivery_point_id: 42 } }, postings: [posting] }, "TEST", "Test", ["Lamp"]);
  expect(result.postings[0].declared_value).toEqual(posting.declared_value);
});

const fixture = () => ({ id: "job-1", shipmentId: "shipment-1", clientId: "app", status: "PENDING", attempts: 0, cancelRequestedAt: null as Date | null, idempotencyKey: "00000000-0000-4000-8000-000000000001", request: { postings: [{ request_id: 1 }, { request_id: 2 }] }, response: null as unknown, shipment: { order: { kind: "ORDER", status: "AWAITING_PAYMENT", payment: { status: "PAID" } as { status: string } | null } } });
describe("Ozon delivery outbox", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.find.mockResolvedValue(fixture()); mocks.claim.mockResolvedValue({ count: 1 });
    mocks.privacy.mockResolvedValue(true);
    mocks.config.mockResolvedValue({ clientId: "app", clientSecret: "synthetic-secret" });
    mocks.transaction.mockImplementation(callback => callback({ ozonDeliveryJob: { updateMany: mocks.claim }, shipment: { update: mocks.shipment, updateMany: mocks.shipment } }));
    mocks.json.mockResolvedValue({ order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] });
    mocks.call.mockResolvedValue(new Response(null));
  });
  it("does not claim or transmit existing pending jobs without Russian storage and operator readiness", async () => {
    mocks.privacy.mockResolvedValue(false);
    expect(await processOzonJob()).toBe(false);
    expect(await processOzonJob("job-1")).toBe(false);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.json).not.toHaveBeenCalled();
  });
  it("reuses the exact persisted body and UUID across ambiguous retries", async () => {
    const job = fixture(); mocks.find.mockResolvedValue(job);
    mocks.json.mockRejectedValueOnce(new Error("synthetic-timeout"));
    await processOzonJob(job.id); await processOzonJob(job.id);
    expect(mocks.json.mock.calls[0]).toEqual(mocks.json.mock.calls[1]);
    expect(mocks.json).toHaveBeenLastCalledWith("/v1/order/create", job.request, { "Idempotency-Key": job.idempotencyKey });
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CREATED" }) }));
    expect(mocks.shipment).toHaveBeenCalledWith({ where: { id: job.shipmentId }, data: { tracking: "p1, p2" } });
  });
  it("does not send unpaid orders, despite a manual button press", async () => {
    const job = fixture(); job.shipment.order.payment!.status = "PENDING"; mocks.find.mockResolvedValue(job);
    await processOzonJob(job.id);
    expect(mocks.json).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ error: "unpaid" }) }));
  });
  it("does not overwrite an ambiguous remote cancellation with a local canceled state", async () => {
    const job = fixture(); job.attempts = 1; job.shipment.order.status = "CANCELED"; mocks.find.mockResolvedValue(job);
    await processOzonJob(job.id);
    expect(mocks.json).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ error: "cancel-review" }) }));
  });
  it("preserves accepted parcels and stops automatic retries for partial responses", async () => {
    mocks.json.mockResolvedValue({ order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, error: { code: "ProviderError" } }] });
    await processOzonJob();
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW", error: "partial", response: { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }] } }) }));
    expect(mocks.find.mock.calls[0][0].where.status).toBe("PENDING");
  });
  it("retains known parcel numbers if a second partial response omits them", async () => {
    const job = fixture(); job.status = "REVIEW"; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }] }; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValue({ order_number: "test-only", postings: [] });
    await processOzonJob(job.id);
    expect(mocks.shipment).toHaveBeenCalledWith({ where: { id: job.shipmentId }, data: { tracking: "p1" } });
  });
  it("never declares an incomplete order fully canceled based on known parcels only", async () => {
    const job = fixture(); job.status = "REVIEW"; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }] }; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValue({ postings: [{ posting_number: "p1", status: "canceled", status_changed_at: "2030-01-01T12:00:00Z" }] });
    await refreshOzonJob(job.id);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW", error: "partial" }) }));
  });
  it("archives only when every known Ozon parcel is delivered", async () => {
    const job = fixture(); job.status = "CREATED"; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] }; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValue({ postings: [{ posting_number: "p1", status: "delivered", status_changed_at: "2030-01-01T12:00:00Z" }, { posting_number: "p2", status: "delivered", status_changed_at: "2030-01-02T12:00:00Z" }] });
    await refreshOzonJob(job.id);
    expect(mocks.shipment).toHaveBeenCalledWith({ where: { id: job.shipmentId, deliveredAt: null }, data: { deliveredAt: new Date("2030-01-02T12:00:00Z") } });
    mocks.shipment.mockClear();
    mocks.json.mockResolvedValue({ postings: [{ posting_number: "p1", status: "delivered", status_changed_at: "2030-01-01T12:00:00Z" }, { posting_number: "p2", status: "canceled", status_changed_at: "2030-01-02T12:00:00Z" }] });
    await refreshOzonJob(job.id); expect(mocks.shipment).not.toHaveBeenCalled();
    job.status = "REVIEW";
    mocks.json.mockResolvedValue({ postings: ["p1", "p2"].map(posting_number => ({ posting_number, status: "delivered", status_changed_at: "2030-01-01T12:00:00Z" })) });
    await refreshOzonJob(job.id); expect(mocks.shipment).not.toHaveBeenCalled();
  });
  it("does not send when another worker owns the lease or credentials changed", async () => {
    mocks.claim.mockResolvedValueOnce({ count: 0 }); await processOzonJob(); expect(mocks.json).not.toHaveBeenCalled();
    mocks.config.mockResolvedValue({ clientId: "another-app", clientSecret: "secret" }); await processOzonJob(); expect(mocks.json).not.toHaveBeenCalled();
  });
  it("creates new contact applications without requiring a payment", async () => {
    const job = fixture(); job.shipment.order.kind = "APPLICATION"; job.shipment.order.status = "NEW"; job.shipment.order.payment = null; mocks.find.mockResolvedValue(job);
    await processOzonJob(); expect(mocks.json).toHaveBeenCalledWith("/v1/order/create", job.request, { "Idempotency-Key": job.idempotencyKey });
    expect(mocks.find.mock.calls[0][0].where.cancelRequestedAt).toBeNull();
    expect(mocks.claim.mock.calls[0][0].where.cancelRequestedAt).toBeNull();
  });
  it("does not create an unsent order merely to cancel it", async () => {
    await cancelOzonJob("job-1"); expect(mocks.json).not.toHaveBeenCalled(); expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED", cancelError: null }) }));
  });
  it("cancels every known parcel and requires confirmed remote statuses", async () => {
    const job = fixture(); job.status = "CREATED"; job.attempts = 1; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] }; mocks.find.mockResolvedValue(job);
    const status = (value: string) => ({ postings: ["p1", "p2"].map(posting_number => ({ posting_number, status: value, status_changed_at: "2030-01-01T12:00:00Z" })) });
    mocks.json.mockResolvedValueOnce(status("created")).mockResolvedValueOnce(status("canceled"));
    await cancelOzonJob(); expect(mocks.call.mock.calls.map(call => call[1].posting_number)).toEqual(["p1", "p2"]);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED", cancelError: null }) }));
  });
  it("keeps cancellation pending if Ozon accepts a request but does not confirm", async () => {
    const job = fixture(); job.status = "CREATED"; job.attempts = 1; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] }; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValue({ postings: ["p1", "p2"].map(posting_number => ({ posting_number, status: "created", status_changed_at: "2030-01-01T12:00:00Z" })) });
    await cancelOzonJob(); expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CREATED", cancelError: "cancel-pending" }) }));
  });
  it("reconciles ambiguous creation with the original idempotency key before canceling", async () => {
    const job = fixture(); job.attempts = 1; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValueOnce({ order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] }).mockResolvedValue({ postings: ["p1", "p2"].map(posting_number => ({ posting_number, status: "canceled", status_changed_at: "2030-01-01T12:00:00Z" })) });
    await cancelOzonJob(); expect(mocks.json).toHaveBeenNthCalledWith(1, "/v1/order/create", job.request, { "Idempotency-Key": job.idempotencyKey });
    expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }));
  });
  it("never declares partial creation fully canceled or calls cancel without all parcel identities", async () => {
    const job = fixture(); job.attempts = 1; job.status = "REVIEW"; mocks.find.mockResolvedValue(job);
    mocks.json.mockResolvedValue({ order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }] });
    await cancelOzonJob(); expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ cancelError: "partial" }) }));
  });
  it("retains cancellation intent on provider errors and never cancels delivered parcels", async () => {
    const job = fixture(); job.status = "CREATED"; job.attempts = 1; job.response = { order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] }; mocks.find.mockResolvedValue(job);
    mocks.json.mockRejectedValueOnce(new Error("synthetic-network")); await cancelOzonJob(); expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ cancelError: "provider" }) }));
    mocks.json.mockResolvedValue({ postings: ["p1", "p2"].map(posting_number => ({ posting_number, status: "delivered", status_changed_at: "2030-01-01T12:00:00Z" })) });
    await cancelOzonJob(); expect(mocks.call).not.toHaveBeenCalled(); expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ cancelError: "already-delivered" }) }));
  });
  it("does not overlap an in-flight creation or erase its lease during cancellation", async () => {
    mocks.claim.mockResolvedValueOnce({ count: 0 }); expect(await cancelOzonJob()).toBe(false); expect(mocks.json).not.toHaveBeenCalled();
  });
});
