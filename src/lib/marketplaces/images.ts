import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedBytes, type Transport } from "./api";
import type { Provider } from "./model";

export function safeImageUrl(value: string, provider: Provider) {
  try {
    const url = new URL(value);
    const roots = provider === "ozon" ? ["ozone.ru", "ozon.ru"] : ["wbbasket.ru", "wbcontent.net", "wildberries.ru"];
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && roots.some((root) => url.hostname.endsWith(`.${root}`));
  } catch { return false; }
}
export function imageExtension(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))) return "avif";
  throw new Error("images");
}
export async function importImages(urls: string[], provider: Provider, transport: Transport = fetch, directory = join(process.cwd(), "public/uploads/products")) {
  const paths: string[] = [];
  await mkdir(directory, { recursive: true });
  for (const url of urls) {
    if (!safeImageUrl(url, provider)) throw new Error("images");
    // Never forward merchant authentication, follow redirects or accept SVG/HTML.
    const response = await transport(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) { await response.body?.cancel(); throw new Error("images"); }
    const bytes = await boundedBytes(response, 10 * 1024 * 1024);
    const extension = imageExtension(bytes);
    const file = `mp-${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    try { await writeFile(join(directory, file), bytes, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    paths.push(`/uploads/products/${file}`);
  }
  return [...new Set(paths)];
}
