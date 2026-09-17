import { ProductGallery } from "@/components/product-gallery";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPrice } from "@/lib/format";
import { ArrowIcon } from "@/components/icons";

type ProductCardData = Prisma.ProductGetPayload<{ include: { images: true; categories: { include: { category: true } } } }>;

export function ProductCard({ product }: { product: ProductCardData }) {
  const category = product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  return (
    <article className="product-card">
      <ProductGallery images={product.images.map(({ path, alt, caption }) => ({ path, alt, caption }))} name={product.name} badge={product.oldPrice && Number(product.oldPrice) > Number(product.basePrice) ? `−${Math.round((1 - Number(product.basePrice) / Number(product.oldPrice)) * 100)}%` : product.badge} href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} compact />
      <div className="product-card__body">
        <span className="eyebrow">{category?.name ?? "3D-печать"}</span>
        <h3><Link href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`}>{product.name}</Link></h3>
        <p>{product.shortDescription}</p>
        <div className="product-card__footer">
          <div><small>Базовая цена</small><strong>{formatPrice(product.basePrice)}</strong>{product.oldPrice && <s>{formatPrice(product.oldPrice)}</s>}</div>
          <Link className="round-link" href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} aria-label={`Открыть ${product.name}`}><ArrowIcon /></Link>
        </div>
      </div>
    </article>
  );
}
