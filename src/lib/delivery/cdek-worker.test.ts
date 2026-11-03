import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), shipment: vi.fn(), config: vi.fn(), privacy: vi.fn(), create: vi.fn(), order: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { cdekDeliveryJob: { findFirst: m.find, updateMany: m.update }, shipment: { updateMany: m.shipment } } }));
vi.mock("@/lib/privacy", () => ({ operatorReady: m.privacy }));
vi.mock("./cdek-config", () => ({ getCdekConfig: m.config }));
vi.mock("./cdek-client", async original => ({ ...await original<typeof import("./cdek-client")>(), CdekDeliveryClient: class { createOrder = m.create; order = m.order; deleteOrder = m.cancel; } }));
import { CdekDeliveryError } from "./cdek-client";
import { processCdekJob } from "./cdek-worker";

const uuid = "09649cbe-9101-4bb6-aa43-2a11e9cafd17";
const fixture = () => ({ id: "job", shipmentId: "shipment", clientId: "account", environment: "test", status: "PENDING", attempts: 0, request: { test: true }, remoteId: null as string | null, cancelRequestedAt: null as Date | null, shipment: { order: { kind: "APPLICATION", payment: null as null | { status: string }, status: "NEW", deletedAt: null as Date | null } } });
describe("CDEK shipment queue", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.find.mockResolvedValue(fixture()); m.update.mockResolvedValue({ count: 1 }); m.privacy.mockResolvedValue(true);
    m.config.mockResolvedValue({ clientId: "account", clientSecret: "test", environment: "test" });
    m.create.mockResolvedValue({ entity: { uuid }, requests: [{ type: "CREATE", state: "ACCEPTED" }] });
    m.order.mockResolvedValue({ entity: { uuid, statuses: [] }, requests: [{ type: "CREATE", state: "SUCCESSFUL" }] });
    m.cancel.mockResolvedValue({}); m.shipment.mockResolvedValue({ count: 1 });
  });
  it("keeps an accepted request pending until CDEK confirms creation", async () => {
    await processCdekJob();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACCEPTED", remoteId: uuid }) }));
  });
  it("does not submit a paid checkout shipment before payment", async () => {
    const job = fixture(); job.shipment.order.kind = "ORDER"; job.shipment.order.payment = { status: "PENDING" }; m.find.mockResolvedValue(job);
    await processCdekJob(); expect(m.create).not.toHaveBeenCalled();
  });
  it("never retries an ambiguous create after a timeout or crash", async () => {
    m.create.mockRejectedValueOnce(new Error("timeout")); await processCdekJob();
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REVIEW", error: "create-uncertain" }) }));
    const job = fixture(); job.status = "SENDING"; m.find.mockResolvedValue(job); m.create.mockClear(); await processCdekJob();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("cancels an unsent deleted order without creating it", async () => {
    const job = fixture(); job.cancelRequestedAt = new Date(); m.find.mockResolvedValue(job); await processCdekJob();
    expect(m.create).not.toHaveBeenCalled(); expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }));
  });
  it("does not report deletion until the asynchronous delete succeeds", async () => {
    const job = fixture(); job.status = "CREATED"; job.remoteId = uuid; job.cancelRequestedAt = new Date(); m.find.mockResolvedValue(job);
    await processCdekJob(); expect(m.cancel).toHaveBeenCalledWith(uuid);
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELING" }) }));
    job.status = "CANCELING"; m.order.mockResolvedValue({ entity: { uuid }, requests: [{ type: "DELETE", state: "SUCCESSFUL" }] }); await processCdekJob();
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }));
  });
  it("recognizes that a previously requested deletion removed the remote order", async () => {
    const job = fixture(); job.status = "CANCELING"; job.remoteId = uuid; job.cancelRequestedAt = new Date(); m.find.mockResolvedValue(job);
    m.order.mockRejectedValue(new CdekDeliveryError("not-found")); await processCdekJob();
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }));
  });
});
