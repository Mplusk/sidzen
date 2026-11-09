import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), user: vi.fn(), find: vi.fn(), create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { guestOrderGrant: { findUnique: mocks.find, create: mocks.create, updateMany: mocks.updateMany, upsert: mocks.upsert } } }));
import { canAccessOrder, grantOrderAccess } from "./order-access";
import { guestOrderSignature, revokeGuestGrant, revokeGuestGrantsForOrder } from "./guest-order-grant";
import { prisma } from "./prisma";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only"); mocks.user.mockResolvedValue(null); mocks.find.mockResolvedValue(null); });
const order = { number: "3DP-TEST", userId: null, createdAt: new Date() };
describe("order access", () => {
  it("validates a random server-side grant and rejects it after ownership transfer", async () => {
    await grantOrderAccess(order.number);
    const value = mocks.set.mock.calls[0][1];
    expect(value).toMatch(/^v2\./);
    mocks.get.mockReturnValue({ value });
    mocks.find.mockResolvedValue({ orderNumber: order.number, expiresAt: new Date(Date.now() + 1000), revokedAt: null });
    expect(await canAccessOrder(order)).toBe(true);
    expect(await canAccessOrder({ ...order, userId: "owner" })).toBe(false);
    mocks.user.mockResolvedValue({ id: "owner" });
    expect(await canAccessOrder({ ...order, userId: "owner" })).toBe(true);
    expect(await canAccessOrder({ ...order, personalDataErasedAt: new Date() })).toBe(false);
  });
  it("rejects revoked, expired or other-order grants", async () => {
    mocks.get.mockReturnValue({ value: "v2.test" });
    mocks.find.mockResolvedValue({ orderNumber: order.number, expiresAt: new Date(Date.now() + 1000), revokedAt: new Date() });
    expect(await canAccessOrder(order)).toBe(false);
    mocks.find.mockResolvedValue({ orderNumber: order.number, expiresAt: new Date(Date.now() - 1), revokedAt: null });
    expect(await canAccessOrder(order)).toBe(false);
    mocks.find.mockResolvedValue({ orderNumber: "OTHER", expiresAt: new Date(Date.now() + 1000), revokedAt: null });
    expect(await canAccessOrder(order)).toBe(false);
  });
  it("honours only unrevoked legacy cookies within the original 30-day window", async () => {
    const value = guestOrderSignature(order.number);
    mocks.get.mockReturnValue({ value });
    expect(await canAccessOrder(order)).toBe(true);
    expect(await canAccessOrder({ ...order, createdAt: new Date(Date.now() - 31 * 86400000) })).toBe(false);
    await revokeGuestGrant(prisma, order.number, value);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    mocks.find.mockResolvedValue({ orderNumber: order.number, expiresAt: new Date(), revokedAt: new Date() });
    expect(await canAccessOrder(order)).toBe(false);
    expect(await canAccessOrder({ ...order, userId: "owner" })).toBe(false);
  });
  it("does not revoke a legacy grant for a forged cookie or malformed Unicode", async () => {
    await revokeGuestGrant(prisma, order.number, "я".repeat(64));
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.get.mockReturnValue({ value: "я".repeat(64) });
    expect(await canAccessOrder(order)).toBe(false);
  });
  it("keeps legacy access revoked if a transferred order later has no owner", async () => {
    mocks.get.mockReturnValue({ value: guestOrderSignature(order.number) });
    await revokeGuestGrantsForOrder(prisma, order.number);
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledOnce();
    mocks.find.mockResolvedValue({ orderNumber: order.number, expiresAt: new Date(), revokedAt: new Date() });
    expect(await canAccessOrder(order)).toBe(false);
  });
});
