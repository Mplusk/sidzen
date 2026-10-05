import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), create: vi.fn(), boundary: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { writeDiagnostic, pruneDiagnosticLogs, LOG_MAX_ROWS } from "./diagnostics";
import { safeDiagnosticDetails, ozonDiagnosticCode, type DiagnosticDetails, type DiagnosticCode } from "./diagnostic-events";
beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(fn => fn({ $executeRaw: m.lock, diagnosticLog: { create: m.create, findFirst: m.boundary, deleteMany: m.remove } }));
  m.boundary.mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());
describe("private bounded diagnostic journal", () => {
  it("drops personal data, credentials and raw exceptions including extra nested keys", () => {
    const hostile = { durationMs: 5, attempts: 2, stage: "quote", provider: "vk", reason: "transport", phone: "+79991234567", token: "secret", email: "buyer@example.test", message: "SQL secret", nested: { password: "secret" } };
    expect(safeDiagnosticDetails(hostile as DiagnosticDetails)).toEqual({ durationMs: 5, attempts: 2, stage: "quote", provider: "vk", reason: "transport" });
    expect(safeDiagnosticDetails({ durationMs: Infinity, attempts: -1, carrierCostKopecks: 0.5, expectedCarrierCostKopecks: 1e15, reason: "error secret", provider: "secret" as "vk", stage: "secret" as "quote" })).toEqual({});
    expect(ozonDiagnosticCode("__proto__")).toBe("delivery.provider");
  });
  it("persists only fixed event fields and a random correlation UUID", async () => {
    const ref = await writeDiagnostic("delivery.transport", { stage: "recheck", durationMs: 20 });
    expect(ref).toMatch(/^[a-f0-9-]{36}$/);
    expect(m.create).toHaveBeenCalledWith({ data: { reference: ref, area: "delivery", level: "ERROR", code: "delivery.transport", details: { durationMs: 20, stage: "recheck" } } });
    expect(m.boundary).toHaveBeenCalledWith(expect.objectContaining({ skip: LOG_MAX_ROWS - 1 }));
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("caps oldest rows under a shared transaction lock and prunes at 30 days", async () => {
    const createdAt = new Date("2030-01-01Z"); m.boundary.mockResolvedValue({ id: "boundary", createdAt });
    await writeDiagnostic("checkout.created");
    expect(m.lock).toHaveBeenCalled();
    expect(m.remove).toHaveBeenCalledWith({ where: { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: "boundary" } }] } });
    m.remove.mockClear(); await pruneDiagnosticLogs(new Date("2030-01-31T00:00:00Z"));
    expect(m.remove).toHaveBeenCalledWith({ where: { createdAt: { lt: createdAt } } });
  });
  it("never blocks checkout or leaks database exception contents if writing fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.transaction.mockRejectedValue(new Error("secret phone email token"));
    expect(await writeDiagnostic("delivery.provider")).toBeNull();
    expect(warning).toHaveBeenCalledWith("Diagnostic event could not be stored; no request data logged.");
    expect(await writeDiagnostic("__proto__" as DiagnosticCode)).toBeNull();
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });
});
