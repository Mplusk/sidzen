import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const m = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), transaction: vi.fn(), save: vi.fn(), upsert: vi.fn(), deactivate: vi.fn(), config: vi.fn(), page: vi.fn(), info: vi.fn(), diagnostic: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ozonDeliverySync: { findFirst: m.find, updateMany: m.claim }, $transaction: m.transaction } }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: m.diagnostic }));
vi.mock("@/lib/privacy", () => ({ operatorReady: vi.fn() }));
vi.mock("./ozon-config", () => ({ getOzonDeliveryConfig: m.config }));
vi.mock("./ozon-client", async importOriginal => {
  const original = await importOriginal<typeof import("./ozon-client")>();
  return { ...original, OzonDeliveryClient: class { pointPage = m.page; pointInfo = m.info; } };
});
import { syncOzonPointsPage } from "./ozon-worker";
import { OzonDeliveryError } from "./ozon-client";
import { safeDiagnosticDetails } from "@/lib/diagnostic-events";

const detail = (id: number) => ({ delivery_point_id: id, name: "Synthetic", full_address: "Synthetic address", type: "pvz", is_active: true, coordinates: null });

beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue({ id: "ozon", clientId: "fixture", methodId: 7n, generation: "generation-1", cursor: "cursor", pages: 1, points: 2 });
  m.claim.mockResolvedValue({ count: 1 });
  m.config.mockResolvedValue({ enabled: true, clientId: "fixture", shipmentMethodId: 7 });
  m.page.mockResolvedValue({ delivery_points: [{ delivery_point_id: 1, shipment_method_ids: [7] }, { delivery_point_id: 2, shipment_method_ids: [7] }], next_cursor: null });
  m.info.mockResolvedValue([detail(1), detail(2)]);
  m.save.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(callback => callback({ ozonDeliverySync: { updateMany: m.save }, ozonDeliveryPoint: { upsert: m.upsert, updateMany: m.deactivate } }));
});

describe("Ozon pickup-directory synchronization", () => {
  it("publishes a complete final page before deactivating old generations", async () => {
    expect(await syncOzonPointsPage()).toBe(true);
    expect(m.upsert).toHaveBeenCalledTimes(2);
    expect(m.deactivate).toHaveBeenCalledTimes(1);
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
  });

  it.each([
    ["missing", [detail(1)]],
    ["duplicate", [detail(1), detail(1)]],
    ["unexpected", [detail(1), detail(3)]],
  ])("rejects %s details without advancing or deactivating the existing directory", async (_kind, points) => {
    m.info.mockResolvedValue(points);
    await syncOzonPointsPage();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.deactivate).not.toHaveBeenCalled();
    expect(m.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "response" }) }));
    expect(m.diagnostic).toHaveBeenCalledWith("delivery.points.failed", { stage: "points", directoryOperation: "info", reason: "response" });
  });

  it("rejects duplicate IDs in the list without requesting details", async () => {
    m.page.mockResolvedValue({ delivery_points: [{ delivery_point_id: 1, shipment_method_ids: [7] }, { delivery_point_id: 1, shipment_method_ids: [7] }], next_cursor: null });
    await syncOzonPointsPage();
    expect(m.info).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.diagnostic).toHaveBeenCalledWith("delivery.points.failed", { stage: "points", directoryOperation: "list", reason: "response" });
  });

  it("does not deactivate the entire old directory when a refresh returns no eligible points", async () => {
    m.find.mockResolvedValue({ id: "ozon", clientId: "fixture", methodId: 7n, generation: "generation-1", cursor: null, pages: 0, points: 0 });
    m.page.mockResolvedValue({ delivery_points: [], next_cursor: null });
    await syncOzonPointsPage();
    expect(m.info).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.claim).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: "response" }) }));
  });

  it("allows an empty final page after earlier pages have already produced points", async () => {
    m.page.mockResolvedValue({ delivery_points: [], next_cursor: null });
    await syncOzonPointsPage();
    expect(m.info).not.toHaveBeenCalled();
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
    expect(m.deactivate).toHaveBeenCalledTimes(1);
  });

  it.each(["page", "info"] as const)("records a schema error in %s as a safe response error without leaking the provider body", async operation => {
    const malformed = z.object({ id: z.number() }).safeParse({ id: "secret phone +79991234567" });
    if (malformed.success) throw new Error("Expected a malformed fixture");
    m[operation].mockRejectedValue(malformed.error);
    await syncOzonPointsPage();
    expect(m.diagnostic).toHaveBeenCalledWith("delivery.points.failed", { stage: "points", directoryOperation: operation === "page" ? "list" : "info", reason: "response" });
    expect(JSON.stringify(m.diagnostic.mock.calls)).not.toContain("secret");
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("preserves a known transport error and allows only fixed operation labels", async () => {
    m.page.mockRejectedValue(new OzonDeliveryError("transport"));
    await syncOzonPointsPage();
    expect(m.diagnostic).toHaveBeenCalledWith("delivery.points.failed", { stage: "points", directoryOperation: "list", reason: "transport" });
    expect(safeDiagnosticDetails({ directoryOperation: "info" })).toEqual({ directoryOperation: "info" });
    expect(safeDiagnosticDetails({ directoryOperation: "secret phone" as "info" })).toEqual({});
  });
});
