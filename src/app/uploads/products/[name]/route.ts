import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { servedProductImageName } from "@/lib/product-admin";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const storedName = servedProductImageName(`/uploads/products/${name}`);
  if (!storedName) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  try {
    const bytes = await readFile(join(process.cwd(), "public", "uploads", "products", storedName));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": contentTypes[storedName.split(".").pop()!.toLowerCase()],
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    console.error("Could not read product image", error);
    return new Response(null, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
