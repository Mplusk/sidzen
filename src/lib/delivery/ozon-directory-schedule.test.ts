import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), config: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("./ozon-config", () => ({ getOzonDeliveryConfig: m.config }));
import { ozonDirectoryRefreshBoundary, scheduleOzonDirectoryRefresh } from "./ozon-directory-schedule";

const tx = { $executeRaw: m.lock, ozonDeliverySync: { findUnique: m.find, create: m.create, updateMany: m.update } };
const config = { enabled: true, clientId: "fixture-client", clientSecret: "fixture-secret", shipmentMethodId: 7, checkedAt: "2026-11-01T00:00:00Z" };
const now = new Date("2026-11-09T00:00:00Z"); // 03:00 Moscow
const oldSync = { id: "ozon", generation: "old-generation", status: "SUCCEEDED", updatedAt: new Date("2026-11-08T05:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(callback => callback(tx));
  m.config.mockResolvedValue(config);
  m.find.mockResolvedValue(oldSync);
  m.update.mockResolvedValue({ count: 1 });
});

describe("nightly cached Ozon directory refresh", () => {
  it("waits until 03:00 Moscow even after the local calendar day has changed", async () => {
    const before = new Date("2026-11-08T23:59:59.999Z");
    expect(ozonDirectoryRefreshBoundary(before)).toBeNull();
    expect(await scheduleOzonDirectoryRefresh(before)).toBe(false);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(ozonDirectoryRefreshBoundary(now)).toEqual(now);
  });

  it("uses the Moscow date through month/year boundaries and catches up after a restart", () => {
    expect(ozonDirectoryRefreshBoundary(new Date("2026-12-31T22:00:00Z"))).toBeNull(); // January 1, 01:00 MSK
    expect(ozonDirectoryRefreshBoundary(new Date("2027-01-01T09:00:00Z"))).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(ozonDirectoryRefreshBoundary(new Date("2026-11-09T20:59:59Z"))).toEqual(now);
    expect(ozonDirectoryRefreshBoundary(new Date("2026-11-09T21:00:00Z"))).toBeNull(); // next day, midnight MSK
  });

  it.each(["SUCCEEDED", "FAILED"])("queues one new generation for an old %s job without removing the cached directory", async status => {
    m.find.mockResolvedValue({ ...oldSync, status });
    expect(await scheduleOzonDirectoryRefresh(now)).toBe(true);
    expect(m.config).toHaveBeenCalledWith(tx);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.config.mock.invocationCallOrder[0]);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({
      where: {
        id: "ozon", generation: "old-generation", updatedAt: oldSync.updatedAt,
        status: { in: ["SUCCEEDED", "FAILED"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: {
        clientId: "fixture-client", methodId: 7n, generation: expect.any(String), cursor: null,
        status: "PENDING", pages: 0, points: 0, error: null, lockToken: null, lockedUntil: null, updatedAt: now,
      },
    });
    expect(m.update.mock.calls[0][0].data.generation).not.toBe(oldSync.generation);
  });

  it.each(["PENDING", "RUNNING"])("does not replace an existing %s job, including a long-running previous night", async status => {
    m.find.mockResolvedValue({ ...oldSync, status });
    expect(await scheduleOzonDirectoryRefresh(now)).toBe(false);
    expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });

  it.each(["SUCCEEDED", "FAILED"])("does not repeat a %s attempt from the same night", async status => {
    m.find.mockResolvedValue({ ...oldSync, status, updatedAt: new Date("2026-11-09T00:15:00Z") });
    expect(await scheduleOzonDirectoryRefresh(new Date("2026-11-09T09:00:00Z"))).toBe(false);
    expect(m.update).not.toHaveBeenCalled();
    expect(await scheduleOzonDirectoryRefresh(new Date("2026-11-10T00:00:00Z"))).toBe(true);
  });

  it.each([
    { enabled: false }, { clientId: "" }, { clientSecret: "" }, { shipmentMethodId: null }, { checkedAt: undefined },
  ])("does not enqueue an unverified or unavailable integration: %j", async changed => {
    m.config.mockResolvedValue({ ...config, ...changed });
    expect(await scheduleOzonDirectoryRefresh(now)).toBe(false);
    expect(m.find).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });

  it("does not win a stale conditional claim if the sync was changed concurrently", async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect(await scheduleOzonDirectoryRefresh(now)).toBe(false);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("creates only one singleton job when two schedulers enter the database lock", async () => {
    let stored: null | { status: string; updatedAt: Date } = null;
    let gate = Promise.resolve();
    // Model the shared PostgreSQL transaction lock used by settings and workers.
    m.transaction.mockImplementation(callback => {
      const next = gate.then(() => callback(tx));
      gate = next.then(() => undefined);
      return next;
    });
    m.find.mockImplementation(async () => stored);
    m.create.mockImplementation(async ({ data }) => { stored = data; return data; });
    const results = await Promise.all([scheduleOzonDirectoryRefresh(now), scheduleOzonDirectoryRefresh(now)]);
    expect(results).toEqual([true, false]);
    expect(m.create).toHaveBeenCalledTimes(1); expect(m.update).not.toHaveBeenCalled();
    expect(m.create.mock.calls[0][0].data).toMatchObject({ id: "ozon", status: "PENDING", clientId: "fixture-client", methodId: 7n, updatedAt: now });
  });
});
