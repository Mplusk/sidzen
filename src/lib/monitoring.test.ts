import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ upsert: vi.fn(), deleted: vi.fn(), product: vi.fn(), category: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findFirst: m.product }, category: { findFirst: m.category }, $transaction: m.transaction } }));
import { pruneMonitoring, recordPageView } from "./monitoring";
beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(callback => callback({ $executeRaw: m.lock, monitoringCounter: { upsert: m.upsert, deleteMany: m.deleted } })); m.product.mockResolvedValue(null); m.category.mockResolvedValue(null); m.deleted.mockResolvedValue({ count: 2 }); });
it("only increments a daily total with no event/visitor/profile fields", async () => {
  await recordPageView("/catalog", new Date("2026-10-18T22:04:05Z"));
  expect(m.upsert).toHaveBeenCalledWith({ where: { day_path: { day: new Date("2026-10-19Z"), path: "/catalog/" } }, create: { day: new Date("2026-10-19Z"), path: "/catalog/", productId: null, views: 1n }, update: { views: { increment: 1n } } });
});
it("never stores guessed catalog paths unless they resolve to public records", async () => {
  for (const path of ["/account/", "/catalog/?q=private", "/catalog/Иван/", "/catalog/decor/Иван/"]) await recordPageView(path);
  expect(m.upsert).not.toHaveBeenCalled();
  m.product.mockResolvedValue({ id: "public-product" });
  await recordPageView("/catalog/decor/coral/");
  expect(m.product).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ slug: "coral", status: "PUBLISHED", categories: { some: { category: { slug: "decor", visible: true } } } }), select: { id: true } }));
  expect(m.upsert.mock.calls[0][0].create.productId).toBe("public-product");
});
it("retains at most 30 calendar days and locks against a simultaneous clear", async () => {
  expect(await pruneMonitoring(new Date("2026-10-18T12:00:00Z"))).toBe(2);
  expect(m.lock).toHaveBeenCalled();
  expect(m.deleted).toHaveBeenCalledWith({ where: { day: { lt: new Date("2026-09-19Z") } } });
});
