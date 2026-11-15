import { Prisma } from "@prisma/client";
import type { getCart } from "@/app/actions/cart";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { productColorFromSpecifications } from "@/lib/product-color";

type Cart = NonNullable<Awaited<ReturnType<typeof getCart>>>;
type Product = NonNullable<Cart["items"][number]["product"]>;

// Stock is checked separately under lock. Compare everything that affects the
// quoted item, its displayed identity, or the carrier's parcel calculation.
export function checkoutProductSnapshot(product: Product) {
  const options = productOptions(product);
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    id: product.id, name: product.name, sku: product.sku, type: product.type, status: product.status, groupId: product.groupId, groupLabel: product.groupLabel, productColor: productColorFromSpecifications(product.specifications),
    basePrice: options.basePrice, weightGrams: options.weightGrams, madeToOrder: product.madeToOrder,
    leadDays: product.leadDays, shippingWeightG: product.shippingWeightG, shippingLengthMm: product.shippingLengthMm,
    shippingWidthMm: product.shippingWidthMm, shippingHeightMm: product.shippingHeightMm, ozonDeclaredValue: product.ozonDeclaredValue?.toString() ?? null,
    materials: sorted(options.materials), colors: sorted(options.colors), variants: sorted(options.variants),
  });
}

/** Call after reserveStock has locked all products; locks are held until commit. */
export async function assertCheckoutProductsUnchanged(tx: Prisma.TransactionClient, cart: Cart) {
  const expected = new Map<string, Product>();
  for (const item of cart.items) {
    if (!item.productId || !item.product) throw new Error("product-changed");
    const previous = expected.get(item.productId);
    if (previous && checkoutProductSnapshot(previous) !== checkoutProductSnapshot(item.product)) throw new Error("product-changed");
    expected.set(item.productId, item.product);
  }
  const ids = [...expected.keys()].sort();
  if (!ids.length) throw new Error("product-changed");
  // Lock every linked option, including inactive ones which could be activated.
  await tx.$queryRaw`SELECT m."id" FROM "Material" m JOIN "_MaterialToProduct" p ON p."A" = m."id" WHERE p."B" IN (${Prisma.join(ids)}) ORDER BY m."id" FOR SHARE OF m`;
  await tx.$queryRaw`SELECT c."id" FROM "Color" c JOIN "_ColorToProduct" p ON p."A" = c."id" WHERE p."B" IN (${Prisma.join(ids)}) ORDER BY c."id" FOR SHARE OF c`;
  await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "productId" IN (${Prisma.join(ids)}) ORDER BY "id" FOR SHARE`;
  const current = await tx.product.findMany({ where: { id: { in: ids } }, include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } } });
  if (current.length !== expected.size || current.some(product => checkoutProductSnapshot(product) !== checkoutProductSnapshot(expected.get(product.id)!))) throw new Error("product-changed");
}
