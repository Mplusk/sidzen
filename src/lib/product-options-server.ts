import type { Prisma } from "@prisma/client";
import type { ProductOptions } from "@/lib/product-options";

export const productOptionInclude = {
  materials: { where: { active: true }, orderBy: { pricePerGram: "asc" as const } },
  colors: { where: { active: true }, orderBy: { name: "asc" as const } },
  variants: { where: { active: true, qualityProfileId: null } },
} satisfies Prisma.ProductInclude;

export type ProductOptionData = Pick<Prisma.ProductGetPayload<{ include: typeof productOptionInclude }>, "id" | "name" | "basePrice" | "weightGrams" | "stock" | "madeToOrder" | "materials" | "colors" | "variants"> & { reservedStock?: number };
export function productOptions(product: ProductOptionData): ProductOptions {
  return { id: product.id, name: product.name, basePrice: Number(product.basePrice), weightGrams: Number(product.weightGrams) || 0, stock: Math.max(0, product.stock - (product.reservedStock ?? 0)), madeToOrder: product.madeToOrder,
    materials: product.materials.map(({ id, slug, name, pricePerGram }) => ({ id, slug, name, pricePerGram: Number(pricePerGram) })),
    colors: product.colors.map(({ id, slug, name, hex }) => ({ id, slug, name, hex })),
    variants: product.variants.map(({ id, materialId, colorId, qualityProfileId, price }) => ({ id, materialId, colorId, qualityProfileId, price: Number(price) })),
  };
}
