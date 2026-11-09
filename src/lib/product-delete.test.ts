import { describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ transaction: vi.fn(), runCount: vi.fn(), findProduct: vi.fn(), deleteProduct: vi.fn(), deleteCart: vi.fn(), deleteListing: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mock.transaction } }));
vi.mock("@/lib/marketplaces/sync", () => ({ marketplaceLock: vi.fn() }));
vi.mock("@/lib/review-images", () => ({ removeReviewPhotos: vi.fn() }));
import { deleteProduct } from "./product-delete";

describe("permanent product deletion", () => {
  const actor = { id: "admin", canPublish: true }, input = { id: "product", confirmation: "product" };
  function setup() {
    vi.clearAllMocks();
    mock.runCount.mockResolvedValue(0);
    mock.findProduct.mockResolvedValue({ id: "product", slug: "slug", name: "Product", sku: "sku", status: "DRAFT", variants: [{ id: "variant" }], images: [], categories: [], reviews: [] });
    mock.transaction.mockImplementation(callback => callback({ $queryRaw: vi.fn(), marketplaceSyncRun: { count: mock.runCount }, product: { findUnique: mock.findProduct, delete: mock.deleteProduct }, orderItem: { count: vi.fn().mockResolvedValue(0) }, cartItem: { deleteMany: mock.deleteCart }, marketplaceListing: { deleteMany: mock.deleteListing }, auditLog: { create: mock.audit } }));
  }
  it("requires matching confirmation before any database work", async () => { setup(); await expect(deleteProduct({ ...input, confirmation: "other" }, actor)).rejects.toThrow("confirmation"); expect(mock.transaction).not.toHaveBeenCalled(); });
  it("rejects active imports", async () => { setup(); mock.runCount.mockResolvedValue(1); await expect(deleteProduct(input, actor)).rejects.toThrow("busy"); expect(mock.deleteProduct).not.toHaveBeenCalled(); });
  it("rejects already deleted products", async () => { setup(); mock.findProduct.mockResolvedValue(null); await expect(deleteProduct(input, actor)).rejects.toThrow("missing"); });
  it("checks current publication status inside transaction", async () => { setup(); mock.findProduct.mockResolvedValue({ status: "PUBLISHED" }); await expect(deleteProduct(input, { ...actor, canPublish: false })).rejects.toThrow("permission"); expect(mock.deleteProduct).not.toHaveBeenCalled(); });
  it("blocks removal while stock is reserved", async () => { setup(); mock.findProduct.mockResolvedValue({ reservedStock: 2 }); await expect(deleteProduct(input, actor)).rejects.toThrow("reserved"); expect(mock.deleteProduct).not.toHaveBeenCalled(); });
  it("removes cart variants/listings and audits without deleting orders", async () => {
    setup(); expect(await deleteProduct(input, actor)).toEqual({ slug: "slug", categories: [] });
    expect(mock.deleteCart).toHaveBeenCalledWith({ where: { OR: [{ productId: "product" }, { variantId: { in: ["variant"] } }] } });
    expect(mock.deleteListing).toHaveBeenCalledWith({ where: { productId: "product" } });
    expect(mock.deleteProduct).toHaveBeenCalledWith({ where: { id: "product" } });
    expect(mock.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "product.delete", actorId: "admin" }) }));
  });
});
