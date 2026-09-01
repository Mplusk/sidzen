import Image from "next/image";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatPrice } from "@/lib/format";
import { ArrowIcon } from "@/components/icons";

type ProductCardData = Prisma.ProductGetPayload<{ include: { images: true; categories: { include: { category: true } } } }>;

export function ProductCard({ product }: { product: ProductCardData }) {
  const image = product.images[0];
  const category = product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  return (
    <article className="product-card">
      <Link href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} className="product-card__image">
        {product.badge && <span className="badge">{product.badge}</span>}
        {image ? <Image src={image.path} alt={image.alt} fill sizes="(max-width: 720px) 92vw, (max-width: 1100px) 45vw, 25vw" /> : <span className="image-placeholder">3D</span>}
      </Link>
      <div className="product-card__body">
        <span className="eyebrow">{category?.name ?? "3D-печать"}</span>
        <h3><Link href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`}>{product.name}</Link></h3>
        <p>{product.shortDescription}</p>
        <div className="product-card__footer">
          <div><strong>от {formatPrice(product.basePrice)}</strong>{product.oldPrice && <s>{formatPrice(product.oldPrice)}</s>}</div>
          <Link className="round-link" href={`/catalog/${category?.slug ?? "products"}/${product.slug}/`} aria-label={`Открыть ${product.name}`}><ArrowIcon /></Link>
        </div>
      </div>
    </article>
  );
}
