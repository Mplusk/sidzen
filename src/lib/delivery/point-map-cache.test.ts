import { describe, expect, it, vi } from "vitest";
import { createPointMapCache } from "./point-map-cache";

describe("bounded pickup map response cache", () => {
  it("reuses serialized results and reloads after the TTL", async () => {
    let time = 0;
    const cache = createPointMapCache({ ttlMs: 100, now: () => time });
    const load = vi.fn().mockResolvedValue('{"points":[]}');
    const first = await cache.get("city", load);
    expect(first.etag).toMatch(/^"[a-f0-9]{64}"$/);
    time = 99;
    expect(await cache.get("city", load)).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    time = 100;
    expect((await cache.get("city", load)).etag).toBe(first.etag);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("deduplicates simultaneous requests and retries a failed load", async () => {
    const cache = createPointMapCache();
    let finish!: (body: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const first = cache.get("city", load), second = cache.get("city", load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    finish("first");
    expect(await first).toBe(await second);
    const failed = vi.fn().mockRejectedValueOnce(new Error("database")).mockResolvedValue("recovered");
    await expect(cache.get("other", failed)).rejects.toThrow("database");
    expect((await cache.get("other", failed)).body).toBe("recovered");
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry when the entry budget is full", async () => {
    const cache = createPointMapCache({ maxEntries: 2 });
    const load = vi.fn(async () => "body");
    await cache.get("one", load); await cache.get("two", load); await cache.get("one", load);
    await cache.get("three", load); await cache.get("one", load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get("two", load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("bounds serialized bytes and does not retain oversized responses", async () => {
    const cache = createPointMapCache({ maxBytes: 150 });
    const load = vi.fn(async () => "small");
    await cache.get("one", load); await cache.get("two", load); await cache.get("three", load);
    await cache.get("one", load);
    expect(load).toHaveBeenCalledTimes(4);
    const large = vi.fn(async () => "я".repeat(100));
    await cache.get("oversized", large); await cache.get("oversized", large);
    expect(large).toHaveBeenCalledTimes(2);
  });

  it("does not repopulate a cleared cache with an old in-flight response", async () => {
    const cache = createPointMapCache();
    let finish!: (body: string) => void;
    const old = cache.get("city", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.clear(); finish("old"); await old;
    const load = vi.fn(async () => "fresh");
    expect((await cache.get("city", load)).body).toBe("fresh");
    expect(load).toHaveBeenCalledOnce();
  });
});
