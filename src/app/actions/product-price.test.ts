import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ require: vi.fn(), lock: vi.fn(), guard: vi.fn(), facets: vi.fn(), transaction: vi.fn(), query: vi.fn(), linked: vi.fn(), update: vi.fn(), audit: vi.fn(), tag: vi.fn(), revalidate: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.require }));
vi.mock("@/lib/catalog-facets-server", () => ({ refreshCatalogFacets: m.facets }));
vi.mock("@/lib/marketplaces/sync", () => ({ marketplaceLock: m.lock, guardProductWrite: m.guard }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("next/cache", () => ({ updateTag: m.tag, revalidatePath: m.revalidate }));
import { updateProductPriceAction } from "./product-price";

const version = "2026-11-10T10:00:00.000Z";
const previous = { success: false, message: "" };
const product = () => ({ id: "p1", sku: "SKU1", status: "PUBLISHED", marketplaceMode: "AUTO", updatedAt: new Date(version), basePrice: new Prisma.Decimal("240"), oldPrice: new Prisma.Decimal("399") });
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ id: "p1", productVersion: version, originalStatus: "PUBLISHED", basePrice: "250.50", oldPrice: "", originalBasePrice: "240", originalOldPrice: "399", acceptSiteMode: "on" })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.require.mockResolvedValue({ id: "admin", roles: [], permissions: new Set(["products.publish"]) });
  m.rate.mockReturnValue({ allowed: true });
  m.query.mockResolvedValue([product()]); m.linked.mockResolvedValue(1);
  m.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ $queryRaw: m.query, marketplaceListing: { count: m.linked }, product: { update: m.update }, auditLog: { create: m.audit } }));
});

describe("product price action", () => {
  it("saves both prices with a transactional audit and preserves linked-card edits", async () => {
    expect(await updateProductPriceAction(previous, form())).toEqual({ success: true, message: "Цена сохранена." });
    expect(m.lock).toHaveBeenCalledOnce(); expect(m.guard).toHaveBeenCalledOnce();
    const change = m.update.mock.calls[0][0].data;
    expect(change.basePrice.toString()).toBe("250.5"); expect(change.oldPrice).toBeNull(); expect(change.marketplaceMode).toBe("SITE");
    expect(m.facets).toHaveBeenCalledOnce();
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ actorId: "admin", action: "product.price.update", before: { basePrice: "240", oldPrice: "399" }, after: { basePrice: "250.5", oldPrice: null } });
    expect(m.tag).toHaveBeenCalledWith("catalog");
  });
  it("does not change site mode for an unchanged linked product", async () => {
    const data = form(); data.set("basePrice", "240.00"); data.set("oldPrice", "399");
    expect((await updateProductPriceAction(previous, data)).success).toBe(true);
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("requires consent if a new marketplace link appeared after opening the form", async () => {
    const data = form(); data.delete("acceptSiteMode");
    expect((await updateProductPriceAction(previous, data)).message).toContain("подтвердите");
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not demand consent when the linked card is already in SITE mode", async () => {
    m.query.mockResolvedValue([{ ...product(), marketplaceMode: "SITE" }]);
    const data = form(); data.delete("acceptSiteMode");
    expect((await updateProductPriceAction(previous, data)).success).toBe(true);
  });
  it("rejects a stale price even when timestamps match", async () => {
    m.query.mockResolvedValue([{ ...product(), basePrice: new Prisma.Decimal("241") }]);
    expect((await updateProductPriceAction(previous, form())).message).toContain("изменился");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a status change within the same millisecond", async () => {
    m.query.mockResolvedValue([{ ...product(), status: "HIDDEN" }]);
    expect((await updateProductPriceAction(previous, form())).message).toContain("изменился");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("requires publish permission for a published product", async () => {
    m.require.mockResolvedValue({ id: "writer", roles: [], permissions: new Set() });
    expect((await updateProductPriceAction(previous, form())).message).toContain("право публикации");
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each(["", "-1", "1.001", "1000000000", "NaN"])("rejects invalid required amount %s", async value => {
    const data = form(); data.set("basePrice", value);
    expect((await updateProductPriceAction(previous, data)).success).toBe(false);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("refuses edits while marketplace synchronization runs", async () => {
    m.guard.mockRejectedValue(new Error("marketplace-busy"));
    expect((await updateProductPriceAction(previous, form())).message).toContain("синхронизации");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("reports an audit failure and does not invalidate the catalog", async () => {
    m.audit.mockRejectedValue(new Error("audit failed"));
    expect((await updateProductPriceAction(previous, form())).success).toBe(false);
    expect(m.tag).not.toHaveBeenCalled();
  });
});
