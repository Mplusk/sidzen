import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { MAX_REVIEW_PHOTO_BYTES, MAX_REVIEW_PHOTOS } from "@/lib/reviews";

const directory = () => join(process.cwd(), "private-uploads", "reviews");
export function reviewImagePath(fileName: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(fileName)) throw new Error("image-name");
  return join(directory(), fileName);
}
export function reviewPhotoFiles(form: FormData) {
  const entries = form.getAll("photos");
  if (entries.some(entry => !(entry instanceof File))) throw new Error("images");
  const files = entries.filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > MAX_REVIEW_PHOTOS || files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_REVIEW_PHOTO_BYTES)) throw new Error("images");
  return files;
}
export async function normalizeReviewPhoto(bytes: Buffer, mime: string) {
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 24_000_000 });
  const metadata = await decoder.metadata();
  const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
  if (!formats[mime] || metadata.format !== formats[mime] || (metadata.pages ?? 1) > 1) throw new Error("images");
  // Decode/re-encode rather than trusting extensions or magic bytes. No EXIF,
  // GPS or other original metadata is copied to the public output.
  return decoder.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
}
export async function removeReviewPhotos(names: string[]) {
  await Promise.all(names.map(name => unlink(reviewImagePath(name)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Review photo cleanup failed");
  })));
}
export async function storeReviewPhotos(files: File[]) {
  const images: Array<{ fileName: string; width: number; height: number; sortOrder: number }> = [];
  try {
    if (files.length) await mkdir(directory(), { recursive: true, mode: 0o700 });
    for (const file of files) {
      const { data, info } = await normalizeReviewPhoto(Buffer.from(await file.arrayBuffer()), file.type);
      const fileName = `${randomUUID()}.webp`;
      await writeFile(reviewImagePath(fileName), data, { flag: "wx", mode: 0o600 });
      images.push({ fileName, width: info.width, height: info.height, sortOrder: images.length });
    }
    return images;
  } catch (error) { await removeReviewPhotos(images.map(image => image.fileName)); throw error; }
}
