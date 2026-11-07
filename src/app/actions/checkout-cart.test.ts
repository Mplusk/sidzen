import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getCart: vi.fn(), update: vi.fn(), remove: vi.fn(), quote: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.getCart }));
vi.mock("@/lib/prisma", () => ({ prisma: { cartItem: { updateMany: m.update, deleteMany: m.remove } } }));
vi.mock("@/lib/product-options", () => ({ priceProduct: m.quote }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { updateCheckoutCartItem } from "./checkout-cart";

const updatedAt = new Date("2030-01-01T00:00:00Z");
const item = { id: "item", quantity: 1, updatedAt, available: true, quote: { unitPrice: 240 }, options: {}, product: { madeToOrder: false, stock: 3 }, selection: { material: "", color: "", quantity: 1 } };

beforeEach(() => {
  vi.resetAllMocks();
  m.getCart.mockResolvedValue({ id: "own-cart", items: [item] });
  m.update.mockResolvedValue({ count: 1 });
  m.remove.mockResolvedValue({ count: 1 });
  m.quote.mockReturnValue({ unitPrice: 240, variantId: null, config: {} });
});

describe("editing the cart during checkout", () => {
  it("recalculates a current item and limits the update to its owner and version", async () => {
    expect(await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).toEqual({});
    expect(m.quote).toHaveBeenCalledWith(item.options, { ...item.selection, quantity: 2 });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "item", cartId: "own-cart", quantity: 1, updatedAt }, data: { quantity: 2, unitPrice: 240, variantId: null, config: {} } });
    expect(m.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("refuses another cart's item, stale quantities and unavailable stock", async () => {
    expect((await updateCheckoutCartItem("someone-else", 1, 2, updatedAt.toISOString())).error).toBeTruthy();
    expect((await updateCheckoutCartItem("item", 2, 3, updatedAt.toISOString())).error).toBeTruthy();
    expect((await updateCheckoutCartItem("item", 1, 4, updatedAt.toISOString())).error).toContain("наличии");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects an outdated row revision even if the quantity is unchanged", async () => {
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, updatedAt: new Date("2030-01-02T00:00:00Z") }] });
    expect((await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).error).toContain("изменилась");
    expect(m.update).not.toHaveBeenCalled();
    expect((await updateCheckoutCartItem("item", 1, 0, "not-a-date")).error).toBeTruthy();
    expect(m.remove).not.toHaveBeenCalled();
  });
  it("removes only the unchanged row and detects a concurrent change", async () => {
    expect(await updateCheckoutCartItem("item", 1, 0, updatedAt.toISOString())).toEqual({});
    expect(m.remove).toHaveBeenCalledWith({ where: { id: "item", cartId: "own-cart", quantity: 1, updatedAt } });
    m.update.mockResolvedValueOnce({ count: 0 });
    expect((await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).error).toContain("изменилась");
  });
  it("allows recovery to available stock, but rejects unpublished or invalid configurations", async () => {
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, quantity: 5, available: false, product: { ...item.product, stock: 2 } }] });
    expect(await updateCheckoutCartItem("item", 5, 2, updatedAt.toISOString())).toEqual({});
    expect((await updateCheckoutCartItem("item", 5, 3, updatedAt.toISOString())).error).toContain("наличии");
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, quantity: 5, available: false, quote: null }] });
    expect((await updateCheckoutCartItem("item", 5, 2, updatedAt.toISOString())).error).toContain("недоступен");
  });
});
