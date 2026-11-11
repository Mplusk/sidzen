import { describe, expect, it, vi } from "vitest";
import { assertCheckoutProductsUnchanged, checkoutProductSnapshot } from "./checkout-product-snapshot";

const product = {
  id: "p", name: "Item", sku: "sku", type: "READY", status: "PUBLISHED", basePrice: 100,
  weightGrams: 100, stock: 5, reservedStock: 0, madeToOrder: false, leadDays: 3,
  shippingWeightG: 200, shippingLengthMm: 100, shippingWidthMm: 100, shippingHeightMm: 100,
  materials: [{ id: "m", slug: "pla", name: "PLA", pricePerGram: 1 }],
  colors: [{ id: "c", slug: "red", name: "Red", hex: "#ff0000" }],
  variants: [{ id: "v", materialId: "m", colorId: "c", qualityProfileId: null, price: 100 }],
};
type SnapshotProduct = Parameters<typeof checkoutProductSnapshot>[0];
type SnapshotCart = Parameters<typeof assertCheckoutProductsUnchanged>[1];
type Tx = Parameters<typeof assertCheckoutProductsUnchanged>[0];

describe("checkout product snapshot", () => {
  it("ignores concurrent reservation counters but catches price, option and packing changes", () => {
    const original = checkoutProductSnapshot(product as unknown as SnapshotProduct);
    expect(checkoutProductSnapshot({ ...product, reservedStock: 2, stock: 4 } as unknown as SnapshotProduct)).toBe(original);
    for (const changed of [
      { ...product, basePrice: 150 },
      { ...product, materials: [{ ...product.materials[0], pricePerGram: 2 }] },
      { ...product, colors: [{ ...product.colors[0], name: "Blue" }] },
      { ...product, groupId: "group", groupLabel: "Чёрный" },
      { ...product, specifications: { "Цвет товара": "Чёрный" } },
      { ...product, variants: [{ ...product.variants[0], price: 250 }] },
      { ...product, shippingWeightG: 300 },
    ]) expect(checkoutProductSnapshot(changed as unknown as SnapshotProduct)).not.toBe(original);
  });

  it("locks option rows and rejects changed data before checkout can commit", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const findMany = vi.fn().mockResolvedValue([{ ...product, basePrice: 101 }]);
    const tx = { $queryRaw: query, product: { findMany } } as unknown as Tx;
    const cart = { items: [{ productId: "p", product }] } as unknown as SnapshotCart;
    await expect(assertCheckoutProductsUnchanged(tx, cart)).rejects.toThrow("product-changed");
    expect(query).toHaveBeenCalledTimes(3);
    expect(findMany).toHaveBeenCalledOnce();
    findMany.mockResolvedValue([product]);
    await expect(assertCheckoutProductsUnchanged(tx, cart)).resolves.toBeUndefined();
  });
});
