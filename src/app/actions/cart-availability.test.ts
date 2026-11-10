import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { cart: { findFirst: m.find } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "buyer" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/legacy-stock-availability", () => ({ legacyStockReviewProductIds: m.legacy }));
import { getCart } from "./cart";

const product = { id: "product", name: "QA product", status: "PUBLISHED", basePrice: 240, weightGrams: 100, stock: 3, reservedStock: 0, madeToOrder: false, materials: [], colors: [], variants: [] };
const row = { id: "row", productId: product.id, variantId: null, modelFileId: null, config: {}, quantity: 1, unitPrice: 240, product, updatedAt: new Date("2030-01-01Z") };
beforeEach(() => {
  vi.resetAllMocks(); m.find.mockResolvedValue({ id: "cart", items: [row] }); m.legacy.mockResolvedValue(new Set([product.id]));
});

describe("cart checkout eligibility", () => {
  it("permits opening a valid legacy-blocked cart without calling its stock available", async () => {
    const cart = await getCart();
    expect(cart!.items[0]).toMatchObject({ canStartCheckout: true, available: false, stockReviewRequired: true, unitPrice: 240 });
    expect(cart!.items[0].quote).not.toBeNull();
  });
  it("retains normal availability after all legacy orders are reconciled", async () => {
    m.legacy.mockResolvedValue(new Set());
    expect((await getCart())!.items[0]).toMatchObject({ canStartCheckout: true, available: true, stockReviewRequired: false });
  });
  it.each([
    { scenario: "unpublished product", value: { ...row, product: { ...product, status: "DRAFT" } } },
    { scenario: "removed material", value: { ...row, config: { material: "removed" } } },
    { scenario: "invalid quantity", value: { ...row, quantity: 0 } },
  ])("does not use legacy review to admit $scenario", async ({ value }) => {
    m.find.mockResolvedValue({ id: "cart", items: [value] });
    expect((await getCart())!.items[0]).toMatchObject({ canStartCheckout: false, available: false, stockReviewRequired: true, quote: null });
  });
  it("checks total quantity across separate rows even if each row individually fits", async () => {
    m.find.mockResolvedValue({ id: "cart", items: [{ ...row, quantity: 2 }, { ...row, id: "other-row", quantity: 2 }] });
    const cart = await getCart();
    expect(cart!.items).toHaveLength(2);
    for (const item of cart!.items) {
      expect(item).toMatchObject({ canStartCheckout: false, available: false, stockReviewRequired: true });
      expect(item.quote).not.toBeNull();
    }
  });
  it("subtracts existing reservations before allowing checkout", async () => {
    m.find.mockResolvedValue({ id: "cart", items: [{ ...row, quantity: 3, product: { ...product, reservedStock: 1 } }] });
    expect((await getCart())!.items[0]).toMatchObject({ canStartCheckout: false, available: false, stockReviewRequired: true });
  });
  it("allows made-to-order configuration to open but preserves its legacy block", async () => {
    m.find.mockResolvedValue({ id: "cart", items: [{ ...row, product: { ...product, stock: 0, madeToOrder: true } }] });
    expect((await getCart())!.items[0]).toMatchObject({ canStartCheckout: true, available: false, stockReviewRequired: true });
  });
});
