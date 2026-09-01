import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const ALLOWED_MODEL_EXTENSIONS = new Set(["stl", "obj", "3mf", "step", "stp"]);

export function uploadDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? path.join(process.cwd(), "private-uploads"));
}

export function modelExtension(filename: string) {
  return path.extname(filename).slice(1).toLowerCase();
}

export function assertModelFile(buffer: Buffer, filename: string) {
  const extension = modelExtension(filename);
  if (!ALLOWED_MODEL_EXTENSIONS.has(extension)) throw new Error("Поддерживаются STL, OBJ, 3MF и STEP");
  if (!buffer.length) throw new Error("Файл пуст");
  const header = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trim().toLowerCase();
  const isBinaryStl = extension === "stl" && buffer.length >= 84 && 84 + buffer.readUInt32LE(80) * 50 === buffer.length;
  const matches =
    (extension === "stl" && (isBinaryStl || header.startsWith("solid"))) ||
    (extension === "obj" && /(^|\n)(v|o|g|#)\s/.test(`\n${header}`)) ||
    (extension === "3mf" && buffer[0] === 0x50 && buffer[1] === 0x4b) ||
    ((extension === "step" || extension === "stp") && header.includes("iso-10303-21"));
  if (!matches) throw new Error("Содержимое файла не соответствует его расширению");
  return extension;
}

export async function storeModelFile(buffer: Buffer, extension: string) {
  const directory = uploadDirectory();
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const storedName = `${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(directory, storedName), buffer, { mode: 0o640, flag: "wx" });
  return storedName;
}

export async function readModelFile(storedName: string) {
  if (path.basename(storedName) !== storedName) throw new Error("Некорректное имя файла");
  return readFile(/* turbopackIgnore: true */ path.join(uploadDirectory(), storedName));
}
