import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ready: vi.fn(), orders: vi.fn(), close: vi.fn(), users: vi.fn(), expire: vi.fn(), account: vi.fn(), drain: vi.fn(), evidence: vi.fn() }));
vi.mock("./privacy", () => ({ rfStorageReady: m.ready }));
vi.mock("./prisma", () => ({ prisma: { order: { findMany: m.orders, updateMany: m.close }, user: { findMany: m.users } } }));
vi.mock("./privacy-erasure", () => ({ eraseExpiredOrders: m.expire, eraseInactiveAccount: m.account, drainErasureFiles: m.drain, pruneErasureEvidence: m.evidence, ErasureError: class extends Error {} }));
import { prunePersonalDataRetention } from "./privacy-retention";
beforeEach(() => { vi.resetAllMocks(); m.ready.mockReturnValue(true); m.orders.mockResolvedValue([]); m.users.mockResolvedValue([]); });
it("does not mutate personal data when Russian storage is unconfirmed", async () => {
  m.ready.mockReturnValue(false); await prunePersonalDataRetention(); expect(m.close).not.toHaveBeenCalled(); expect(m.drain).not.toHaveBeenCalled();
});
it("separates closed unpaid applications, fiscal-year evidence and inactive nonstaff accounts", async () => {
  const now = new Date("2026-10-15T12:00:00Z");
  m.orders.mockResolvedValue([{ id: "expired" }]); m.users.mockResolvedValue([{ id: "inactive" }]);
  await prunePersonalDataRetention(now);
  expect(m.expire).toHaveBeenCalledWith(["expired"], now);
  expect(m.account).toHaveBeenCalledWith("inactive", now);
  expect(m.orders.mock.calls[0][0].where.privacyClosedAt.lte).toEqual(new Date("2026-09-16T12:00:00Z"));
  const serialized = JSON.stringify(m.orders.mock.calls[0][0].where);
  expect(serialized).toContain("2020-12-31T21:00:00.000Z");
  expect(serialized).toContain("refundReviewRequired"); expect(serialized).toContain("retentionHoldUntil");
  expect(m.users.mock.calls[0][0].where).toMatchObject({ lastActiveAt: { lt: new Date("2024-10-15T12:00:00Z") }, roles: { every: { role: { code: "customer" } } }, sessions: { none: { expiresAt: { gt: now } } } });
  expect(m.drain).toHaveBeenCalledOnce(); expect(m.evidence).toHaveBeenCalledWith(now);
});
