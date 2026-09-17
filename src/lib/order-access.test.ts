import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), user: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
import { canAccessOrder, grantOrderAccess } from "./order-access";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only"); mocks.user.mockResolvedValue(null); });
describe("order access", () => {
  it("allows only a valid guest signature or the owning account", async () => {
    const order = { number: "3DP-TEST", userId: "owner" };
    mocks.get.mockReturnValue(undefined); expect(await canAccessOrder(order)).toBe(false);
    mocks.user.mockResolvedValue({ id: "stranger" }); expect(await canAccessOrder(order)).toBe(false);
    mocks.user.mockResolvedValue({ id: "owner" }); expect(await canAccessOrder(order)).toBe(true);
    mocks.user.mockResolvedValue(null); await grantOrderAccess(order.number);
    mocks.get.mockReturnValue({ value: mocks.set.mock.calls[0][1] }); expect(await canAccessOrder(order)).toBe(true);
    expect(await canAccessOrder({ ...order, number: "OTHER" })).toBe(false);
  });
  it("rejects malformed Unicode cookies without a length exception", async () => {
    mocks.get.mockReturnValue({ value: "я".repeat(64) });
    expect(await canAccessOrder({ number: "3DP-TEST", userId: null })).toBe(false);
  });
});
