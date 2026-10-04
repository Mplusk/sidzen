import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), transaction: vi.fn(), shipment: vi.fn(), config: vi.fn(), json: vi.fn(), privacy: vi.fn() }));
vi.mock("@/lib/privacy", () => ({ operatorReady: mocks.privacy }));
vi.mock("@/lib/prisma", () => ({ prisma: { ozonDeliveryJob: { findFirst: mocks.find, updateMany: mocks.claim }, $transaction: mocks.transaction } }));
vi.mock("./ozon-config", () => ({ getOzonDeliveryConfig: mocks.config }));
vi.mock("./ozon-client", async importOriginal => {
  const original = await importOriginal<typeof import("./ozon-client")>();
  return { ...original, OzonDeliveryClient: class { json = mocks.json; } };
});
import { processOzonJob, refreshOzonJob } from "./ozon-worker";

const fixture = () => ({ id: "job-1", shipmentId: "shipment-1", clientId: "app", status: "PENDING", attempts: 0, idempotencyKey: "00000000-0000-4000-8000-000000000001", request: { postings: [{ request_id: 1 }, { request_id: 2 }] }, response: null as unknown, shipment: { order: { status: "AWAITING_PAYMENT", payment: { status: "PAID" } } } });
describe("Ozon delivery outbox", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.find.mockResolvedValue(fixture()); mocks.claim.mockResolvedValue({ count: 1 });
    mocks.privacy.mockResolvedValue(true);
    mocks.config.mockResolvedValue({ clientId: "app", clientSecret: "synthetic-secret" });
    mocks.transaction.mockImplementation(callback => callback({ ozonDeliveryJob: { updateMany: mocks.claim }, shipment: { update: mocks.shipment } }));
    mocks.json.mockResolvedValue({ order_number: "test-only", postings: [{ request_id: 1, posting_number: "p1" }, { request_id: 2, posting_number: "p2" }] });
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
    const job = fixture(); job.shipment.order.payment.status = "PENDING"; mocks.find.mockResolvedValue(job);
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
  it("does not send when another worker owns the lease or credentials changed", async () => {
    mocks.claim.mockResolvedValueOnce({ count: 0 }); await processOzonJob(); expect(mocks.json).not.toHaveBeenCalled();
    mocks.config.mockResolvedValue({ clientId: "another-app", clientSecret: "secret" }); await processOzonJob(); expect(mocks.json).not.toHaveBeenCalled();
  });
});
