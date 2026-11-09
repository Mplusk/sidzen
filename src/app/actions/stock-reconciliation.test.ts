import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), release: vi.fn(), legacy: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/stock-reconciliation", () => ({ releaseReviewedStock: m.release }));
vi.mock("@/lib/legacy-stock-reconciliation", () => ({ confirmLegacyStock: m.legacy }));
vi.mock("next/cache", () => ({ updateTag: m.updateTag, revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { releaseReviewedStockAction, confirmLegacyStockAction } from "./stock-reconciliation";

function form() {
  const f = new FormData();
  for (const [key, value] of Object.entries({ orderId: "id", number: "3DP-1", confirmation: "3DP-1", reason: "Товар на складе", physical: "on", obligations: "on", reviewed: "on", reviewSnapshot: "a".repeat(64), products: '[{"id":"p","stock":1,"reservedStock":0}]' })) f.set(key, value);
  return f;
}
describe("stock review actions", () => {
  beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "admin" }); });
  it("checks order write permissions before releasing", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    await expect(releaseReviewedStockAction(form())).rejects.toThrow("forbidden");
    expect(m.release).not.toHaveBeenCalled();
  });
  it("requires both explicit attestations and a matching order number", async () => {
    const f = form(); f.delete("physical");
    await expect(releaseReviewedStockAction(f)).rejects.toThrow("stock=confirmation");
    expect(m.release).not.toHaveBeenCalled();
    const wrong = form(); wrong.set("confirmation", "OTHER");
    await expect(releaseReviewedStockAction(wrong)).rejects.toThrow("stock=confirmation");
    expect(m.release).not.toHaveBeenCalled();
  });
  it("requires explicit legacy verification and parses the stock snapshot", async () => {
    const f = form(); f.delete("reviewed");
    await expect(confirmLegacyStockAction(f)).rejects.toThrow("legacyStock=error");
    expect(m.legacy).not.toHaveBeenCalled();
    await expect(confirmLegacyStockAction(form())).rejects.toThrow("legacyStock=saved");
    expect(m.legacy).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin", products: [{ id: "p", stock: 1, reservedStock: 0 }] }));
  });
});
