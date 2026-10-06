import { opendir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

// Recover files orphaned by a crash or a product deletion. The 24-hour grace
// protects uploads whose DB transaction has not committed yet. Only our own
// UUID WebP files in this specific directory are considered, never model files.
export async function pruneOrphanReviewPhotos(now = Date.now()) {
  const directory = join(process.cwd(), "private-uploads", "reviews");
  let entries;
  try { entries = await opendir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for await (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(entry.name)) continue;
    const file = join(directory, entry.name), info = await stat(file).catch(() => null);
    if (!info || info.mtimeMs >= now - 86400000) continue;
    if (!await prisma.reviewImage.count({ where: { fileName: entry.name } })) await unlink(file).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
