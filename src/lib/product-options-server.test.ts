import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { productOptions } from "./product-options-server";

describe("available stock in product options", () => {
  const product = { id: "p", name: "Товар", basePrice: new Prisma.Decimal(100), weightGrams: null, stock: 5, reservedStock: 3, madeToOrder: false, materials: [], colors: [], variants: [] };
  it("excludes reserved items from the quantity available to the cart", () => {
    expect(productOptions(product).stock).toBe(2);
  });
  it("never advertises a negative available quantity", () => {
    expect(productOptions({ ...product, reservedStock: 7 }).stock).toBe(0);
  });
});
