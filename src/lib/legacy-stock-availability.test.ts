import { expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { legacyStockReviewProductIds } from "./legacy-stock-availability";

it("returns only requested product IDs requiring legacy stock review", async () => {
  const findMany = vi.fn().mockResolvedValue([{ productId: "p1" }, { productId: null }]);
  const db = { orderItem: { findMany } } as unknown as Pick<Prisma.TransactionClient, "orderItem">;
  expect([...await legacyStockReviewProductIds(["p1", "p1", "p2"], db)]).toEqual(["p1"]);
  expect(findMany).toHaveBeenCalledWith({ where: { productId: { in: ["p1", "p2"] }, order: { inventoryTracked: false } }, select: { productId: true }, distinct: ["productId"] });
  expect((await legacyStockReviewProductIds([], db)).size).toBe(0);
  expect(findMany).toHaveBeenCalledOnce();
});

