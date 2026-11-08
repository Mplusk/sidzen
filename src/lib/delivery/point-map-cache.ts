import { createHash } from "node:crypto";

type MapPayload = Readonly<{ body: string; etag: string }>;
type Entry = { value: MapPayload; expiresAt: number; bytes: number };

// This is a small per-process response cache, not a second pickup directory.
// PostgreSQL remains authoritative; config and sync identity are checked by
// the route before looking up a key. A restart only drops this acceleration.
export function createPointMapCache({ ttlMs = 300000, maxEntries = 20, maxBytes = 16 * 1024 * 1024, now = Date.now }: {
  ttlMs?: number; maxEntries?: number; maxBytes?: number; now?: () => number;
} = {}) {
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<MapPayload>>();
  let bytes = 0;
  let revision = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  };
  const materialize = (body: string): MapPayload => Object.freeze({ body, etag: `"${createHash("sha256").update(body).digest("hex")}"` });

  async function get(key: string, load: () => Promise<string>): Promise<MapPayload> {
    const time = now();
    for (const [expiredKey, entry] of entries) if (entry.expiresAt <= time) remove(expiredKey);
    const cached = entries.get(key);
    if (cached) { entries.delete(key); entries.set(key, cached); return cached.value; }
    const existing = pending.get(key);
    if (existing) return existing;
    // Avoid retaining an unbounded set of promises for arbitrary search terms.
    if (pending.size >= maxEntries) return materialize(await load());
    const startedRevision = revision;
    const task = Promise.resolve().then(load).then(body => {
      const value = materialize(body);
      const size = Buffer.byteLength(key) + Buffer.byteLength(body) + Buffer.byteLength(value.etag);
      if (startedRevision === revision && size <= maxBytes && maxEntries > 0 && ttlMs > 0) {
        while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value!);
        entries.set(key, { value, expiresAt: now() + ttlMs, bytes: size });
        bytes += size;
      }
      return value;
    });
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  }

  return { get, clear() { revision++; entries.clear(); pending.clear(); bytes = 0; } };
}

export const pointMapCache = createPointMapCache();
