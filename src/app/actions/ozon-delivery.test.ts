import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllEnvs());
const mocks = vi.hoisted(() => ({ permission: vi.fn(), config: vi.fn(), methods: vi.fn(), verify: vi.fn(), points: vi.fn(), save: vi.fn(), sync: vi.fn(), count: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/app/actions/cart", () => ({ getCart: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/delivery/ozon-config", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: mocks.config }));
vi.mock("@/lib/delivery/ozon-client", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { shipmentMethods = mocks.methods; verifyMethod = mocks.verify; pointPage = mocks.points; } }));
import { decryptSecret } from "@/lib/integration-secrets";
import { saveOzonDelivery } from "./ozon-delivery";
const form = () => { const data = new FormData(); data.set("clientId", "fixture-app"); data.set("clientSecret", "fixture-secret"); data.set("shipmentMethodId", ""); data.set("dispatchDays", "1"); data.set("enabled", "on"); return data; };
describe("Ozon credential setup", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-key");
    mocks.permission.mockResolvedValue({ id: "admin" });
    mocks.config.mockResolvedValue({ enabled: false, clientId: "", clientSecret: "", shipmentMethodId: null, dispatchDays: 1 });
    mocks.methods.mockResolvedValue([]); mocks.points.mockResolvedValue({ delivery_points: [] }); mocks.count.mockResolvedValue(0);
    mocks.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), siteSetting: { upsert: mocks.save }, ozonDeliveryJob: { count: mocks.count }, ozonDeliverySync: { findUnique: vi.fn(), upsert: mocks.sync }, auditLog: { create: vi.fn() } }));
  });
  it("saves verified credentials encrypted even when Ozon has no shipment methods", async () => {
    await expect(saveOzonDelivery(form())).rejects.toThrow("ozon-no-method");
    const config = mocks.save.mock.calls[0][0].update.value;
    expect(config).toMatchObject({ enabled: false, clientId: "fixture-app", shipmentMethodId: null, methods: [] });
    expect(config.authorizedAt).toBeTruthy(); expect(config.checkedAt).toBeUndefined();
    expect(config.clientSecret).not.toBe("fixture-secret"); expect(decryptSecret(config.clientSecret, "integrations.ozon-delivery")).toBe("fixture-secret");
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("selects the only active method, verifies it, and starts PVZ synchronization", async () => {
    mocks.methods.mockResolvedValue([{ shipment_method_id: 7, name: "Наш пункт", status: "active" }]); mocks.verify.mockResolvedValue({ name: "Наш пункт" });
    await expect(saveOzonDelivery(form())).rejects.toThrow("ozon-verified");
    expect(mocks.verify).toHaveBeenCalledWith(7);
    expect(mocks.save.mock.calls[0][0].update.value).toMatchObject({ enabled: true, shipmentMethodId: 7, methodName: "Наш пункт" });
    expect(mocks.sync).toHaveBeenCalled();
  });
  it("never guesses between multiple active methods or activates a blocked method", async () => {
    mocks.methods.mockResolvedValue([{ shipment_method_id: 7, name: "A", status: "active" }, { shipment_method_id: 8, name: "B", status: "active" }]);
    await expect(saveOzonDelivery(form())).rejects.toThrow("ozon-select-method");
    expect(mocks.save.mock.calls[0][0].update.value.enabled).toBe(false);
    mocks.methods.mockResolvedValue([{ shipment_method_id: 7, name: "A", status: "blocked" }]);
    await expect(saveOzonDelivery(form())).rejects.toThrow("ozon-no-method");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("does not store credentials after failed permission/auth/API verification", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(saveOzonDelivery(form())).rejects.toThrow("forbidden"); expect(mocks.methods).not.toHaveBeenCalled();
    mocks.methods.mockRejectedValueOnce(new Error("invalid credentials"));
    await expect(saveOzonDelivery(form())).rejects.toThrow("ozon-connection"); expect(mocks.save).not.toHaveBeenCalled();
  });
});
