import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(), sessionFind: vi.fn(), userUpdate: vi.fn(), transaction: vi.fn(), cookieSet: vi.fn(), cookieGet: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/favorites-merge", () => ({ mergeGuestFavorites: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { create: mocks.sessionCreate, findUnique: mocks.sessionFind },
  user: { updateMany: mocks.userUpdate }, $transaction: mocks.transaction,
} }));

import { createSession, getCurrentUser } from "./auth";

describe("last known authenticated visit", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "test-token" });
    mocks.sessionCreate.mockResolvedValue({}); mocks.userUpdate.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  });
  afterEach(() => vi.useRealTimers());
  it("records a sign-in together with the new session", async () => {
    await createSession("user-1");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "user-1", isActive: true, OR: [{ lastVisitedAt: null }, { lastVisitedAt: { lt: now } }] }, data: { lastVisitedAt: now } });
  });
  it("updates a valid user's visit after an hour", async () => {
    mocks.sessionFind.mockResolvedValue({ expiresAt: new Date(now.getTime() + 10000), user: { id: "user-1", isActive: true, lastActiveAt: now, lastVisitedAt: new Date(now.getTime() - 7200000), roles: [] } });
    await getCurrentUser();
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "user-1", isActive: true, OR: [{ lastVisitedAt: null }, { lastVisitedAt: { lt: new Date(now.getTime() - 3600000) } }] }, data: { lastVisitedAt: now } });
  });
  it("does not update a recent visit or an expired session", async () => {
    const user = { id: "user-1", isActive: true, lastActiveAt: now, lastVisitedAt: new Date(now.getTime() - 60000), roles: [] };
    mocks.sessionFind.mockResolvedValueOnce({ expiresAt: new Date(now.getTime() + 10000), user }).mockResolvedValueOnce({ expiresAt: new Date(now.getTime() - 1), user: { ...user, lastVisitedAt: null } });
    await getCurrentUser(); await getCurrentUser();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
