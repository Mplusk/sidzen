import type { Prisma } from "@prisma/client";
import type { ProductOptions } from "@/lib/product-options";

export const productOptionInclude = {
  materials: { where: { active: true }, orderBy: { pricePerGram: "asc" as const } },
  colors: { where: { active: true }, orderBy: { name: "asc" as const } },
  qualityProfiles: { where: { active: true }, orderBy: { layerHeightMm: "desc" as const } },
  variants: { where: { active: true } },
} satisfies Prisma.ProductInclude;

export type ProductOptionData = Pick<Prisma.ProductGetPayload<{ include: typeof productOptionInclude }>, "id" | "name" | "basePrice" | "weightGrams" | "stock" | "madeToOrder" | "materials" | "colors" | "qualityProfiles" | "variants">;
export function productOptions(product: ProductOptionData): ProductOptions {
  return { id: product.id, name: product.name, basePrice: Number(product.basePrice), weightGrams: Number(product.weightGrams) || 0, stock: product.stock, madeToOrder: product.madeToOrder,
    materials: product.materials.map(({ id, slug, name, pricePerGram }) => ({ id, slug, name, pricePerGram: Number(pricePerGram) })),
    colors: product.colors.map(({ id, slug, name, hex }) => ({ id, slug, name, hex })),
    qualities: product.qualityProfiles.map(({ id, slug, name, layerHeightMm, priceMultiplier }) => ({ id, slug, name, layerHeightMm: Number(layerHeightMm), priceMultiplier: Number(priceMultiplier) })),
    variants: product.variants.map(({ id, materialId, colorId, qualityProfileId, price }) => ({ id, materialId, colorId, qualityProfileId, price: Number(price) })),
  };
}
