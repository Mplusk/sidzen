import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { fivePostSchema } from "@/lib/delivery/fivepost-config";
import { decryptSecret, encryptSecret } from "@/lib/integration-secrets";

const m = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), upsert: vi.fn(), warehouse: vi.fn(), points: vi.fn(), sync: vi.fn(), audit: vi.fn(), pending: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.auth }));
vi.mock("@/app/actions/cart", () => ({ getCart: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/delivery/fivepost-client", () => ({ FivePostClient: class { warehouse = m.warehouse; points = m.points; } }));
vi.mock("@/lib/prisma", () => {
  const db = { siteSetting: { findUnique: m.find, upsert: m.upsert }, fivePostDirectory: { findUnique: async () => null, upsert: m.sync }, fivePostDeliveryJob: { count: m.pending }, auditLog: { create: m.audit }, $executeRaw: m.lock };
  return { prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
});
import { saveFivePostDelivery } from "./fivepost-delivery";

const key = "integrations.fivepost-delivery", warehouseId = randomUUID();
function form(intent: "enable" | "disable" | "check") {
  const data = new FormData();
  for (const [k, v] of Object.entries({ intent, version: "[null,false]", environment: "production", apiKey: "qa-only", warehouseId, rateType: "Hub", baseKg: "1" })) data.set(k, v);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "unit-test-key");
  m.auth.mockResolvedValue({ id: "admin" }); m.find.mockResolvedValue(null);
  m.warehouse.mockResolvedValue("STORE-1"); m.points.mockResolvedValue({ content: [], totalPages: 0 }); m.pending.mockResolvedValue(0);
});
it("requires settings.write and verifies the warehouse and directory before enabling", async () => {
  await expect(saveFivePostDelivery(form("enable"))).rejects.toThrow("fivepost-on");
  expect(m.auth).toHaveBeenCalledWith("settings.write");
  expect(m.warehouse).toHaveBeenCalledWith(warehouseId); expect(m.points).toHaveBeenCalledWith(0, 1);
  expect(m.sync).toHaveBeenCalledOnce();
  const value = m.upsert.mock.calls[0][0].update.value;
  expect(value).toMatchObject({ enabled: true, senderLocation: "STORE-1" });
  expect(value.apiKey).not.toContain("qa-only"); expect(decryptSecret(value.apiKey, key)).toBe("qa-only");
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain("qa-only");
});
it("switches off without contacting the provider and keeps the saved credentials", async () => {
  m.find.mockResolvedValue({ value: fivePostSchema.parse({ enabled: true, checkedAt: "checked", environment: "production", warehouseId, apiKey: encryptSecret("existing", key) }) });
  const data = new FormData(); data.set("intent", "disable"); data.set("version", '["checked",true]');
  await expect(saveFivePostDelivery(data)).rejects.toThrow("fivepost-off");
  const value = m.upsert.mock.calls[0][0].update.value;
  expect(value.enabled).toBe(false); expect(decryptSecret(value.apiKey, key)).toBe("existing");
  expect(m.points).not.toHaveBeenCalled(); expect(m.warehouse).not.toHaveBeenCalled();
});
it("keeps the storefront disabled for test credentials and a failed production check", async () => {
  const data = form("enable"); data.set("environment", "test");
  await expect(saveFivePostDelivery(data)).rejects.toThrow("fivepost-invalid");
  m.warehouse.mockRejectedValueOnce(new Error("unavailable"));
  await expect(saveFivePostDelivery(form("enable"))).rejects.toThrow("fivepost-connection");
  expect(m.upsert).not.toHaveBeenCalled();
});
it("does not allow a stale form to overwrite a newer decision", async () => {
  const data = form("enable"); data.set("version", '["old",true]');
  await expect(saveFivePostDelivery(data)).rejects.toThrow("fivepost-changed");
  expect(m.upsert).not.toHaveBeenCalled(); expect(m.warehouse).not.toHaveBeenCalled();
});
