type Counter = { count: number; resetAt: number };
const counters = new Map<string, Counter>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count) };
}
