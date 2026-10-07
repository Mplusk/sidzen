import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), change: vi.fn(), limit: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/clients", () => ({ setClientArchived: m.change }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("next/cache", () => ({ revalidatePath: m.invalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
import { changeClientArchive } from "./clients";
const input = (operation = "archive") => { const form = new FormData(); form.set("clientKey", "account:qa"); form.set("operation", operation); form.set("confirmation", operation); return form; };
describe("client removal/restoration action", () => {
  beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "actor" }); m.limit.mockReturnValue({ allowed: true }); m.change.mockResolvedValue(true); });
  it("rechecks both read and write permissions before changing data", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    await expect(changeClientArchive(input())).rejects.toThrow("forbidden"); expect(m.change).not.toHaveBeenCalled();
    expect(m.permission).toHaveBeenCalledWith("customers.write");
  });
  it("requires explicit confirmation, valid operation/key and rate-limit allowance", async () => {
    const missing = input(); missing.delete("confirmation");
    const invalid = input("destroy-account"); const huge = input(); huge.set("clientKey", "a".repeat(1025));
    for (const form of [missing, invalid, huge]) await expect(changeClientArchive(form)).rejects.toThrow("result=confirmation");
    expect(m.change).not.toHaveBeenCalled();
    m.limit.mockReturnValue({ allowed: false }); await expect(changeClientArchive(input())).rejects.toThrow("result=rate"); expect(m.change).not.toHaveBeenCalled();
  });
  it("archives and restores only the selected contact card with fixed redirect targets", async () => {
    await expect(changeClientArchive(input())).rejects.toThrow("/account/clients/?result=deleted");
    expect(m.permission).toHaveBeenCalledWith("customers.read"); expect(m.change).toHaveBeenCalledWith("account:qa", true, "actor");
    await expect(changeClientArchive(input("restore"))).rejects.toThrow("view=deleted&result=restored");
    expect(m.change).toHaveBeenLastCalledWith("account:qa", false, "actor"); expect(m.invalidate).toHaveBeenCalledWith("/account/clients/");
  });
});
