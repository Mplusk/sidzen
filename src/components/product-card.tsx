import { ProductGallery } from "@/components/product-gallery";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPrice } from "@/lib/format";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { defaultProductPrice } from "@/lib/product-options";
import { FavoriteButton } from "@/components/favorite-button";

type ProductCardData = Prisma.ProductGetPayload<{ include: typeof productOptionInclude & { images: true; categories: { include: { category: true } } } }>;

export function ProductCard({ product, highPriority = false }: { product: ProductCardData; highPriority?: boolean }) {
  const category = product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  const price = defaultProductPrice(productOptions(product));
  const available = Math.max(0, product.stock - product.reservedStock);
  const discounted = product.oldPrice && Number(product.oldPrice) > price;
  return (
    <article className="product-card">
      <div className="product-card__media"><ProductGallery images={product.images.map(({ path, alt, caption, width, height }) => ({ path, alt, caption, width, height }))} name={product.name} badge={product.badge} href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} compact highPriority={highPriority} /><FavoriteButton productId={product.id} name={product.name} /></div>
      <div className="product-card__body">
        <div className={"product-card__price" + (discounted ? " product-card__price--sale" : "")}>
          <strong>{formatPrice(price)}</strong>
          {discounted && <><s>{formatPrice(product.oldPrice!)}</s><span className="product-card__discount">−{Math.round((1 - price / Number(product.oldPrice)) * 100)}%</span></>}
        </div>
        <h3><Link href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`}>{product.name}</Link></h3>
        <span className={"product-card__availability" + (available > 0 || product.madeToOrder ? " is-available" : "")}>{available > 0 ? "В наличии" : product.madeToOrder ? "Под заказ" : "Нет в наличии"}</span>
      </div>
    </article>
  );
}
