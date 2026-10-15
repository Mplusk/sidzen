import { ProductGallery } from "@/components/product-gallery";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPrice } from "@/lib/format";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { defaultProductPrice } from "@/lib/product-options";

type ProductCardData = Prisma.ProductGetPayload<{ include: typeof productOptionInclude & { images: true; categories: { include: { category: true } } } }>;

export function ProductCard({ product, highPriority = false }: { product: ProductCardData; highPriority?: boolean }) {
  const category = product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  const price = defaultProductPrice(productOptions(product));
  const discounted = product.oldPrice && Number(product.oldPrice) > price;
  return (
    <article className="product-card">
      <ProductGallery images={product.images.map(({ path, alt, caption }) => ({ path, alt, caption }))} name={product.name} badge={product.badge} href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} compact highPriority={highPriority} />
      <div className="product-card__body">
        <div className={"product-card__price" + (discounted ? " product-card__price--sale" : "")}>
          <strong>{formatPrice(price)}</strong>
          {discounted && <><s>{formatPrice(product.oldPrice!)}</s><span className="product-card__discount">−{Math.round((1 - price / Number(product.oldPrice)) * 100)}%</span></>}
        </div>
        <h3><Link href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`}>{product.name}</Link></h3>
        <span className={"product-card__availability" + (product.stock > 0 || product.madeToOrder ? " is-available" : "")}>{product.stock > 0 ? "В наличии" : product.madeToOrder ? "Под заказ" : "Нет в наличии"}</span>
      </div>
    </article>
  );
}
