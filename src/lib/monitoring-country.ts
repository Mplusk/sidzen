import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isIP } from "node:net";

// ONLY read the packaged database. Importing this package's executable code would
// fetch a CDN, which is deliberately forbidden for visitor statistics.
const buffers = new Map<string, Buffer>();
function data(file: string) {
  let buffer = buffers.get(file);
  if (!buffer) {
    const directory = dirname(createRequire(join(process.cwd(), "package.json")).resolve("@iplookup/country"));
    buffer = readFileSync(join(directory, file));
    if (buffers.size >= 130) buffers.clear();
    buffers.set(file, buffer);
  }
  return buffer;
}
function floorIndex(count: number, read: (index: number) => bigint, ip: bigint) {
  let low = 0, high = count - 1, result = -1;
  while (low <= high) { const mid = (low + high) >>> 1; if (read(mid) <= ip) { result = mid; low = mid + 1; } else high = mid - 1; }
  return result;
}
export function monitoringCountry(address: string | null) {
  try {
    if (!address) return null;
    address = address.replace(/^::ffff:/i, "");
    const version = isIP(address); if (!version) return null;
    if (version === 4) {
      const [a, b] = address.split(".").map(Number);
      if ([0, 10, 127].includes(a) || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return null;
    } else if (address === "::" || address === "::1" || /^(?:f[cd]|fe[89ab])/i.test(address)) return null;
    let ip: bigint;
    if (version === 4) ip = address.split(".").reduce((value, part) => (value << 8n) + BigInt(part), 0n);
    else {
      // The offline IPv6 table uses the high 64 bits of the address.
      if (address.includes(".")) return null;
      const halves = address.split("::"), left = halves[0] ? halves[0].split(":") : [], right = halves[1] ? halves[1].split(":") : [];
      const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
      ip = parts.slice(0, 4).reduce((value: bigint, part: string) => (value << 16n) + BigInt("0x" + part), 0n);
    }
    const size = version === 4 ? 4 : 8;
    const read = (buffer: Buffer, index: number) => size === 4 ? BigInt(buffer.readUInt32LE(index * size)) : buffer.readBigUInt64LE(index * size);
    const indexes = data(`${version}.idx`), chunk = floorIndex(indexes.length / size, index => read(indexes, index), ip);
    if (chunk < 0) return null;
    const records = data(`${version}/${chunk.toString(36).padStart(2, "_")}`), count = records.length / (size * 2 + 2);
    const row = floorIndex(count, index => read(records, index), ip);
    if (row < 0 || ip > read(records, count + row)) return null;
    const code = records.toString("ascii", count * size * 2 + row * 2, count * size * 2 + row * 2 + 2);
    return /^[A-Z]{2}$/.test(code) && code !== "ZZ" ? code : null;
  } catch { return null; } // Missing/corrupt data never prevents shopping.
}
