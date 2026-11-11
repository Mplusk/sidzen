import { destinationCity } from "./destination-city";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();

// Optimal string alignment distance: one typo may be an insertion, deletion,
// substitution or adjacent transposition. City names are short and bounded.
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

export function cityNames(addresses: { address: string }[]) {
  const names = new Map<string, { name: string; count: number }>();
  for (const row of addresses) {
    const city = destinationCity(row.address, "ozon-delivery");
    if (!city || city.length > 80) continue;
    const key = normalize(city);
    const entry = names.get(key);
    if (entry) entry.count++;
    else names.set(key, { name: city, count: 1 });
  }
  // For short prefixes, put cities with more pickup addresses first.
  return [...names.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).map(entry => entry.name);
}

export type PreparedCity = { name: string; normalized: string };
export function prepareCityNames(names: string[]): PreparedCity[] {
  const seen = new Set<string>();
  return names.flatMap(name => {
    const normalized = normalize(name);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ name, normalized }];
  });
}

export function rankPreparedCities(query: string, names: PreparedCity[]) {
  const q = normalize(query);
  if (q.length < 2 || q.length > 80) return [];
  const prefix: string[] = [];
  const corrections: { name: string; score: number }[] = [];
  for (const { name, normalized: n } of names) {
    if (n.startsWith(q)) {
      prefix.push(name);
      if (prefix.length === 8) return prefix;
      continue;
    }
    if (q.length < 4 || q.length > 80 || Math.abs(q.length - n.length) > (q.length >= 8 ? 2 : 1)) continue;
    const edits = distance(q, n);
    if (edits <= (q.length >= 8 ? 2 : 1)) corrections.push({ name, score: edits });
  }
  corrections.sort((a, b) => a.score - b.score);
  return prefix.concat(corrections.map(entry => entry.name)).slice(0, 8);
}

export function rankCities(query: string, names: string[], exact: string[] = []) {
  return rankPreparedCities(query, prepareCityNames([...exact, ...names]));
}

// One bounded cache slot per process; concurrent requests share the build.
// Identity includes configuration and sync generation/status, so completing a
// directory refresh invalidates it. The TTL also catches out-of-band changes.
let cached: { key: string; expires: number; value: Promise<string[]> } | undefined;
export function cityIndex(key: string, load: () => Promise<{ address: string }[]>) {
  const now = Date.now();
  if (cached?.key === key && cached.expires > now) return cached.value;
  const value = load().then(cityNames);
  const entry = { key, expires: now + 60 * 60_000, value };
  cached = entry;
  value.catch(() => { if (cached === entry) cached = undefined; });
  return value;
}
