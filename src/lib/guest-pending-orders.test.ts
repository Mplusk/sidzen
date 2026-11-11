import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), cookies: vi.fn(), find: vi.fn(), allow: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: m.cookies }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findMany: m.find } } }));
vi.mock("@/lib/guest-order-grant", () => ({ guestGrantAllows: m.allow }));
import { getGuestPendingOrders } from "./guest-pending-orders";

const first = { id: "one", number: "3DP-301101-12345678", userId: null, status: "AWAITING_PAYMENT", deletedAt: null, personalDataErasedAt: null, reservationExpiredAt: null, reservationExpiresAt: new Date("2099-01-01"), createdAt: new Date(), payment: { provider: "yookassa-online", status: "PENDING", payload: null } };
const second = { ...first, id: "two", number: "3DP-301101-87654321" };

describe("guest payment recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.user.mockResolvedValue(null);
    m.cookies.mockReturnValue([{ name: `3dp_order_${first.number}`, value: "valid" }, { name: `3dp_order_${second.number}`, value: "forged" }]);
    m.find.mockResolvedValue([first, second]); m.allow.mockImplementation(async (_db, _order, value) => value === "valid");
  });
  it("shows only an order whose own guest grant is valid", async () => {
    expect(await getGuestPendingOrders()).toEqual([first]);
    expect(m.allow).toHaveBeenCalledTimes(2);
  });
  it("does not offer an expired order or enumerate another account", async () => {
    m.find.mockResolvedValue([{ ...first, reservationExpiresAt: new Date(0) }, second]);
    expect(await getGuestPendingOrders()).toEqual([]);
    m.user.mockResolvedValue({ id: "signed-in" });
    await expect(getGuestPendingOrders()).resolves.toEqual([]);
    expect(m.find).toHaveBeenCalledTimes(1);
  });
});
