import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { product: { findMany: m.findMany } } }));
import { getCatalogPricePage } from "./catalog-price-page";
const row = (id: string, basePrice: number, variant?: number) => ({ id, name: id, basePrice, weightGrams: 0, stock: 1, madeToOrder: false, materials: [], colors: [], qualityProfiles: [], variants: variant === undefined ? [] : [{ id: `v-${id}`, materialId: null, colorId: null, qualityProfileId: null, price: variant }] });
const args = { where: { status: "PUBLISHED" as const }, orderBy: [{ stock: "desc" as const }, { id: "asc" as const }], page: 1, pageSize: 2 };
beforeEach(() => vi.clearAllMocks());
it("filters and sorts actual variant prices, not base prices, before pagination", async () => {
  m.findMany.mockResolvedValue([row("a", 100, 900), row("b", 800, 100.5), row("c", 149.99), row("d", 300)]);
  expect(await getCatalogPricePage({ ...args, descending: false, min: 100, max: 300 })).toEqual({ count: 3, pages: 2, page: 1, ids: ["b", "c"] });
  expect(await getCatalogPricePage({ ...args, descending: true, min: 100, max: 300, page: 2 })).toEqual({ count: 3, pages: 2, page: 2, ids: ["b"] });
  expect(m.findMany.mock.calls[0][0]).toMatchObject({ where: args.where, orderBy: [{ id: "asc" }], take: 200 });
  expect(m.findMany.mock.calls[0][0].select).not.toHaveProperty("images");
});
it("preserves database new/availability order for price bounds and handles empty or excessive pages", async () => {
  m.findMany.mockResolvedValue([row("z", 300), row("a", 149.99), row("m", 400)]);
  expect((await getCatalogPricePage({ ...args, min: 150, max: 400 })).ids).toEqual(["z", "a"]);
  expect(m.findMany.mock.calls[0][0].orderBy).toEqual(args.orderBy);
  expect(await getCatalogPricePage({ ...args, min: 500, max: 100 })).toEqual({ count: 0, pages: 1, page: 1, ids: [] });
  expect(await getCatalogPricePage({ ...args, descending: false, page: 900 })).toEqual({ count: 3, pages: 2, page: 2, ids: ["m"] });
});
it("prices candidates in bounded batches and keeps a stable order for tied prices", async () => {
  m.findMany.mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => row(`p-${String(i).padStart(3, "0")}`, 1))).mockResolvedValueOnce([row("p-200", 1)]);
  expect(await getCatalogPricePage({ ...args, descending: false, page: 101 })).toEqual({ count: 201, pages: 101, page: 101, ids: ["p-200"] });
  expect(m.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "p-199" }, skip: 1, take: 200 });
});
