import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ozon: vi.fn(), cdek: vi.fn(), authorize: vi.fn(), point: vi.fn(), verify: vi.fn(), page: vi.fn(),
  update: vi.fn(), audit: vi.fn(), sync: vi.fn(), find: vi.fn(), lock: vi.fn(), transaction: vi.fn(), permission: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/delivery/ozon-config", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: m.ozon }));
vi.mock("@/lib/delivery/cdek-config", async original => ({ ...await original<typeof import("@/lib/delivery/cdek-config")>(), getCdekConfig: m.cdek }));
vi.mock("@/lib/delivery/ozon-client", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { verifyMethod = m.verify; pointPage = m.page; } }));
vi.mock("@/lib/delivery/cdek-client", () => ({ CdekDeliveryClient: class { authorize = m.authorize; deliveryPoint = m.point; } }));
import { setDeliveryAvailability } from "./delivery-availability";

const ozon = { enabled: true, clientId: "client", clientSecret: "secret", shipmentMethodId: 1, dispatchDays: 1, checkedAt: "2026-01-01" };
const cdek = { enabled: true, clientId: "client", clientSecret: "secret", environment: "production", senderCityCode: 44, senderPoint: "P1", senderName: "Seller", senderPhone: "+79990000000", checkedAt: "2026-01-01" };

describe("delivery availability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.permission.mockResolvedValue({ id: "admin" });
    m.ozon.mockResolvedValue(ozon); m.cdek.mockResolvedValue(cdek);
    m.find.mockResolvedValue({ value: { enabled: true, clientSecret: "encrypted-secret" } });
    m.transaction.mockImplementation(callback => callback({ $executeRaw: m.lock, siteSetting: { findUnique: m.find, update: m.update }, auditLog: { create: m.audit }, ozonDeliverySync: { upsert: m.sync } }));
  });

  it.each(["ozon", "cdek"] as const)("disables %s without calling the provider or changing the stored secret", async carrier => {
    expect(await setDeliveryAvailability(carrier, false)).toEqual({});
    expect(m.authorize).not.toHaveBeenCalled(); expect(m.verify).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { value: { enabled: false, clientSecret: "encrypted-secret" } } }));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "admin", after: { enabled: false } }) }));
  });

  it("does not enable CDEK when the sender point is unavailable", async () => {
    m.cdek.mockResolvedValue({ ...cdek, enabled: false });
    m.point.mockResolvedValue([{ code: "P1", is_reception: false, status: "ACTIVE", location: { city_code: 44 } }]);
    expect((await setDeliveryAvailability("cdek", true)).error).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("validates Ozon before enabling and refreshes the pickup point directory", async () => {
    m.ozon.mockResolvedValue({ ...ozon, enabled: false });
    expect(await setDeliveryAvailability("ozon", true)).toEqual({});
    expect(m.verify).toHaveBeenCalledWith(1); expect(m.page).toHaveBeenCalledWith(null);
    expect(m.sync).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent settings change", async () => {
    m.cdek.mockResolvedValueOnce(cdek).mockResolvedValueOnce({ ...cdek, senderPoint: "P2" });
    expect((await setDeliveryAvailability("cdek", false)).error).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
  });
});
