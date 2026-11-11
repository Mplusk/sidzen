import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { reserveStock } from "./stock-reservations";

function fixture(product: { stock: number; reservedStock: number; madeToOrder: boolean }, legacy = false) {
  const update = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: "p", status: "PUBLISHED", ...product }]), product: { update }, orderItem: { findFirst: vi.fn().mockResolvedValue(legacy ? { id: "old" } : null) } };
  return { tx: tx as unknown as Prisma.TransactionClient, update };
}
describe("stock reservation", () => {
  it("sums multiple variants of the same product before checking available quantity", async () => {
    const { tx, update } = fixture({ stock: 3, reservedStock: 1, madeToOrder: false });
    await expect(reserveStock(tx, [{ productId: "p", quantity: 2 }, { productId: "p", quantity: 1 }])).rejects.toThrow("stock-changed");
    expect(update).not.toHaveBeenCalled();
  });
  it("reserves available finished items before making the remainder to order", async () => {
    const { tx, update } = fixture({ stock: 5, reservedStock: 3, madeToOrder: true });
    await expect(reserveStock(tx, [{ productId: "p", quantity: 4 }])).resolves.toEqual(new Map([["p", 2]]));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { reservedStock: { increment: 2 } } }));
  });
  it("blocks sales until old active orders are reconciled", async () => {
    const { tx, update } = fixture({ stock: 5, reservedStock: 0, madeToOrder: true }, true);
    await expect(reserveStock(tx, [{ productId: "p", quantity: 1 }])).rejects.toThrow("stock-legacy-review");
    expect(update).not.toHaveBeenCalled();
  });
  it("checks every product before reserving any stock when one is unavailable", async () => {
    const { tx, update } = fixture({ stock: 5, reservedStock: 0, madeToOrder: false });
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ id: "a", status: "PUBLISHED", stock: 5, reservedStock: 0, madeToOrder: false }, { id: "b", status: "PUBLISHED", stock: 0, reservedStock: 0, madeToOrder: false }]);
    await expect(reserveStock(tx, [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 1 }])).rejects.toThrow("stock-changed");
    expect(update).not.toHaveBeenCalled();
  });
});
