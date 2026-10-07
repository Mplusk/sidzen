/** Re-render the supplied SIDZEN vector mark, never replace product photography. */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

const mark = await readFile("public/brand/sidzen-mark.svg");
for (const [size, file] of [[192, "icon-192.png"], [512, "icon-512.png"], [180, "apple-touch-icon.png"]] as const) {
  const inset = Math.round(size * .15), width = size - inset * 2;
  const image = await sharp(mark).resize(width, width, { fit: "contain" }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#F8F5EF" } }).composite([{ input: image, left: inset, top: inset }]).png().toFile(`public/${file}`);
}
const icon = await sharp(mark).resize(32, 32, { fit: "contain", background: "#F8F5EF" }).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = 32; ico[7] = 32;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(icon.length, 14); ico.writeUInt32LE(22, 18);
await writeFile("public/favicon.ico", Buffer.concat([ico, icon]));
const logo = await sharp(await readFile("public/brand/sidzen-logo.svg")).resize(840).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#F8F5EF" } }).composite([{ input: logo, gravity: "centre" }]).png().toFile("public/brand/sidzen-social.png");
