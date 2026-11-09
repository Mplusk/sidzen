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
  const names = new Map<string, string>();
  for (const row of addresses) {
    const city = destinationCity(row.address, "ozon-delivery");
    if (city && city.length <= 80) names.set(normalize(city), city);
  }
  return [...names.values()];
}

export function rankCities(query: string, names: string[], exact: string[] = []) {
  const q = normalize(query);
  const results = new Map<string, { name: string; score: number }>();
  const add = (name: string, score: number) => {
    const key = normalize(name), current = results.get(key);
    if (!current || score < current.score) results.set(key, { name, score });
  };
  for (const name of exact) add(name, 0);
  for (const name of names) {
    const n = normalize(name);
    if (n.startsWith(q)) { add(name, 0); continue; }
    if (q.length < 4 || q.length > 80 || Math.abs(q.length - n.length) > (q.length >= 8 ? 2 : 1)) continue;
    const edits = distance(q, n);
    if (edits <= (q.length >= 8 ? 2 : 1)) add(name, edits);
  }
  return [...results.values()].sort((a, b) => a.score - b.score).slice(0, 8).map(entry => entry.name);
}

// One bounded cache slot per process; concurrent requests share the build.
// Identity includes configuration and sync generation/status, so completing a
// directory refresh cannot reuse an old index for the next ten minutes.
let cached: { key: string; expires: number; value: Promise<string[]> } | undefined;
export function cityIndex(key: string, load: () => Promise<{ address: string }[]>) {
  const now = Date.now();
  if (cached?.key === key && cached.expires > now) return cached.value;
  const value = load().then(cityNames);
  const entry = { key, expires: now + 10 * 60_000, value };
  cached = entry;
  value.catch(() => { if (cached === entry) cached = undefined; });
  return value;
}
