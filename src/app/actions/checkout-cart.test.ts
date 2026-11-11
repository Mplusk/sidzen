import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getCart: vi.fn(), findMany: vi.fn(), update: vi.fn(), remove: vi.fn(), product: vi.fn(), legacy: vi.fn(), quote: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.getCart }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(), cartItem: { findMany: m.findMany, updateMany: m.update, deleteMany: m.remove }, product: { findUnique: m.product } }) } }));
vi.mock("@/lib/product-options", () => ({ priceProduct: m.quote }));
vi.mock("@/lib/legacy-stock-availability", () => ({ legacyStockReviewProductIds: m.legacy }));
vi.mock("@/lib/cart-stock-holds", () => ({
  lockCartHold: async () => ({ hold: null, products: [{ id: "product", ...await m.product() }] }),
  adjustLockedCartHold: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { updateCheckoutCartGroup } from "./checkout-cart";
const updatedAt = new Date("2030-01-01T00:00:00Z");
const state = createHash("sha256").update(JSON.stringify(["product", null, null, {}])).digest("hex");
const row = { id: "a", productId: "product", variantId: null, modelFileId: null, config: {}, quantity: 1, updatedAt };
const row2 = { ...row, id: "b" };
const view = { ...row, groupKey: "same", groupState: state, quote: { unitPrice: 240 }, options: { stock: 5 }, product: { madeToOrder: false }, selection: { material: "", color: "", quantity: 1 }, stockReviewRequired: false };
const member = (id: string) => ({ id, quantity: 1, revision: updatedAt.toISOString(), state });
beforeEach(() => { vi.resetAllMocks(); m.getCart.mockResolvedValue({ id: "cart", items: [view, { ...view, id: "b" }] }); m.findMany.mockResolvedValue([row, row2]); m.product.mockResolvedValue({ stock: 5, reservedStock: 0, madeToOrder: false, status: "PUBLISHED" }); m.legacy.mockResolvedValue(new Set()); m.update.mockResolvedValue({ count: 1 }); m.remove.mockResolvedValue({ count: 1 }); m.quote.mockReturnValue({ unitPrice: 240, variantId: null, config: {} }); });
it("updates all identical rows atomically and preserves their combined quantity", async () => { expect(await updateCheckoutCartGroup([member("a"), member("b")], 3)).toEqual({}); expect(m.update).toHaveBeenCalledOnce(); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ returnedOrderItemId: null }) })); expect(m.remove).toHaveBeenCalledOnce(); expect(m.revalidate).toHaveBeenCalled(); });
it("rejects changed snapshots and failed compare-and-set", async () => { expect((await updateCheckoutCartGroup([{ ...member("a"), state: "b".repeat(64) }, member("b")], 2)).error).toBeTruthy(); m.findMany.mockResolvedValueOnce([{ ...row, config: { color: "red" } }, row2]); expect((await updateCheckoutCartGroup([member("a"), member("b")], 2)).error).toBeTruthy(); m.remove.mockResolvedValueOnce({ count: 0 }); expect((await updateCheckoutCartGroup([member("a"), member("b")], 2)).error).toBeTruthy(); });
it("rejects insufficient or unverified stock and still permits deletion", async () => { m.product.mockResolvedValueOnce({ stock: 1, reservedStock: 0, madeToOrder: false, status: "PUBLISHED" }); expect((await updateCheckoutCartGroup([member("a"), member("b")], 2)).error).toBeTruthy(); expect(await updateCheckoutCartGroup([member("a"), member("b")], 0)).toEqual({}); });
it("does not rewrite an unknown legacy configuration", async () => { m.getCart.mockResolvedValueOnce({ id: "cart", items: [{ ...view, groupKey: null }] }); expect((await updateCheckoutCartGroup([member("a")], 2)).error).toContain("нельзя изменить"); expect(m.update).not.toHaveBeenCalled(); });

