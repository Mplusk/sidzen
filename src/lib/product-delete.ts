import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { marketplaceLock } from "@/lib/marketplaces/sync";
import { servedProductImageName } from "@/lib/product-admin";
import { removeReviewPhotos } from "@/lib/review-images";

const schema = z.object({ id: z.string().min(1).max(100), confirmation: z.string().min(1).max(100) }).refine(data => data.id === data.confirmation);
export async function deleteProduct(input: { id: string; confirmation: string }, actor: { id: string; canPublish: boolean }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("confirmation");
  const result = await prisma.$transaction(async tx => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new Error("busy");
    const product = await tx.product.findUnique({ where: { id: parsed.data.id }, include: {
      images: true, variants: true, marketplaceIdentities: true, marketplaceListings: true,
      categories: { include: { category: { select: { slug: true } } } }, reviews: { include: { images: true } },
    } });
    if (!product) throw new Error("missing");
    if (product.status === "PUBLISHED" && !actor.canPublish) throw new Error("permission");
    await tx.cartItem.deleteMany({ where: { OR: [{ productId: product.id }, { variantId: { in: product.variants.map(row => row.id) } }] } });
    await tx.marketplaceListing.deleteMany({ where: { productId: product.id } });
    // Database cascades remove variants, reviews/photos, favorites, category
    // links and pending AI work; OrderItem retains its immutable sale snapshot.
    await tx.product.delete({ where: { id: product.id } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "product.delete", entityType: "Product", entityId: product.id, before: { sku: product.sku, name: product.name, status: product.status } } });
    return { slug: product.slug, categories: product.categories.map(row => row.category.slug), paths: product.images.map(row => row.path), reviewPhotos: product.reviews.flatMap(row => row.images.map(image => image.fileName)) };
  }, { maxWait: 10_000, timeout: 30_000 });
  // Only exact, validated files owned by this product are candidates. Shared
  // product images and marketplace snapshots must continue to work.
  for (const path of new Set(result.paths)) {
    const name = servedProductImageName(path);
    if (!name) continue;
    try {
      await prisma.$transaction(async tx => {
        await marketplaceLock(tx);
        // A new import may have started after deletion committed, and its
        // downloaded content-addressed files are not referenced until apply.
        if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) return;
        const references = await Promise.all([
          tx.productImage.count({ where: { path } }),
          tx.marketplaceListing.count({ where: { snapshot: { path: ["images"], array_contains: [path] } } }),
          tx.category.count({ where: { image: path } }), tx.material.count({ where: { image: path } }), tx.color.count({ where: { image: path } }),
        ]);
        if (references.every(count => count === 0)) await unlink(join(process.cwd(), "public/uploads/products", name)).catch(error => { if (error.code !== "ENOENT") throw error; });
      });
    } catch { console.error("Unused deleted-product image cleanup failed"); }
  }
  try { await removeReviewPhotos(result.reviewPhotos); }
  catch { console.error("Deleted-product review photo cleanup failed"); }
  return { slug: result.slug, categories: result.categories };
}
