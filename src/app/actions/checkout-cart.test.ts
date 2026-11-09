import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getCart: vi.fn(), update: vi.fn(), remove: vi.fn(), quote: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.getCart }));
vi.mock("@/lib/prisma", () => ({ prisma: { cartItem: { updateMany: m.update, deleteMany: m.remove } } }));
vi.mock("@/lib/product-options", () => ({ priceProduct: m.quote }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { updateCheckoutCartItem } from "./checkout-cart";

const updatedAt = new Date("2030-01-01T00:00:00Z");
const item = { id: "item", productId: "product", quantity: 1, updatedAt, available: true, quote: { unitPrice: 240 }, options: { stock: 3 }, product: { madeToOrder: false, stock: 3, reservedStock: 0 }, selection: { material: "", color: "", quantity: 1 } };

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
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, quantity: 5, available: false, options: { stock: 2 }, product: { ...item.product, stock: 2 } }] });
    expect(await updateCheckoutCartItem("item", 5, 2, updatedAt.toISOString())).toEqual({});
    expect((await updateCheckoutCartItem("item", 5, 3, updatedAt.toISOString())).error).toContain("наличии");
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, quantity: 5, available: false, quote: null }] });
    expect((await updateCheckoutCartItem("item", 5, 2, updatedAt.toISOString())).error).toContain("недоступен");
  });
  it("uses stock after reservations rather than the physical quantity", async () => {
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, options: { stock: 2 }, product: { ...item.product, stock: 5, reservedStock: 3 } }] });
    expect(await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).toEqual({});
    expect((await updateCheckoutCartItem("item", 1, 3, updatedAt.toISOString())).error).toContain("наличии");
    expect(m.update).toHaveBeenCalledTimes(1);
  });
  it("counts other variants of the same product but not different products", async () => {
    const otherVariant = { ...item, id: "other-variant", quantity: 2 };
    const otherProduct = { ...item, id: "other-product", productId: "other", quantity: 20 };
    m.getCart.mockResolvedValue({ id: "own-cart", items: [item, otherVariant, otherProduct] });
    expect((await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).error).toContain("наличии");
    expect(await updateCheckoutCartItem("item", 1, 1, updatedAt.toISOString())).toEqual({});
    expect(m.update).toHaveBeenCalledTimes(1);
  });
  it("allows quantities beyond ready stock for made-to-order goods", async () => {
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, options: { stock: 0 }, product: { ...item.product, madeToOrder: true, stock: 0 } }] });
    expect(await updateCheckoutCartItem("item", 1, 4, updatedAt.toISOString())).toEqual({});
  });
  it("fails closed if stock or the product identity is missing", async () => {
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, options: {} }] });
    expect((await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).error).toContain("недоступен");
    m.getCart.mockResolvedValue({ id: "own-cart", items: [{ ...item, productId: null }] });
    expect((await updateCheckoutCartItem("item", 1, 2, updatedAt.toISOString())).error).toContain("недоступен");
    expect(m.update).not.toHaveBeenCalled();
  });
});
