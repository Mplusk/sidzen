import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { defaultProductPrice } from "@/lib/product-options";
import { ProductGallery } from "@/components/product-gallery";
import { FavoriteButton } from "@/components/favorite-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizePageTitle } from "@/lib/seo";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { ProductPurchaseForm } from "@/components/product-purchase-form";
import { ProductPurchaseState, ProductMobilePrice } from "@/components/product-purchase-state";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { pluralRu } from "@/lib/format";
import { productSpecificationRows } from "@/lib/product-specifications";
import { TruckIcon } from "@/components/icons";
import { ProductReviews } from "@/components/product-reviews";
import { requestPublicReviewWhere } from "@/lib/review-visibility";
import { ProductGroupOptions, type GroupOption } from "@/components/product-group-options";

type Params = Promise<{ category: string; product: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { product: slug, category } = await params;
  const product = await prisma.product.findUnique({ where: { slug }, include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } });
  if (!product || product.status !== "PUBLISHED" || (product.type !== "READY" && product.type !== "PARAMETRIC")) return { title: "Товар не найден", robots: { index: false } };
  const title = normalizePageTitle(product.title ?? product.name);
  return {
    title,
    description: product.metaDescription ?? product.shortDescription,
    alternates: { canonical: product.canonical ?? `/catalog/${category}/${product.slug}/` },
    robots: product.robots,
    openGraph: { title, description: product.metaDescription ?? product.shortDescription ?? undefined, images: product.images[0] ? [{ url: product.images[0].path, alt: product.images[0].alt }] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: { params: Params; searchParams: Promise<{ reviewsPage?: string }> }) {
  const { product: slug, category: categorySlug } = await params;
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      ...productOptionInclude,
      images: { orderBy: { sortOrder: "asc" } },
      categories: { include: { category: true } },
      materials: { where: { active: true }, orderBy: { name: "asc" } },
      colors: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });
  if (!product || product.status !== "PUBLISHED" || (product.type !== "READY" && product.type !== "PARAMETRIC")) notFound();
  const category = product.categories.find((item) => item.category.slug === categorySlug)?.category ?? product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  if (!category || !category.visible || !product.categories.some((item) => item.category.slug === categorySlug)) notFound();
  const related = await prisma.product.findMany({ where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, id: { not: product.id }, categories: { some: { categoryId: category.id } } }, include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" } }, categories: { include: { category: true } } }, take: 4 });
  const members = product.groupId ? await prisma.product.findMany({
    where: { groupId: product.groupId, status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { visible: true } } } },
    select: { id: true, name: true, sku: true, slug: true, groupLabel: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { path: true } }, categories: { where: { category: { visible: true } }, orderBy: { isPrimary: "desc" }, take: 1, select: { category: { select: { slug: true } } } } },
    orderBy: { sku: "asc" },
  }) : [];
  const groupOptions: GroupOption[] = members.map(member => ({ id: member.id, name: member.name, label: member.groupLabel || member.sku, image: member.images[0]?.path ?? null, href: `/catalog/${member.categories[0].category.slug}/${member.slug}/` }));
  const options = productOptions(product);
  const defaultPrice = defaultProductPrice(options);
  const publicReviewWhere = await requestPublicReviewWhere();
  const aggregate = await prisma.review.aggregate({ where: { productId: product.id, ...publicReviewWhere }, _avg: { rating: true }, _count: { _all: true } });
  const reviewCount = aggregate._count._all, rating = aggregate._avg.rating ?? 0;
  const query = await searchParams;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images.map((item) => `https://sidzen.shop${item.path}`),
    description: product.shortDescription,
    sku: product.sku,
    brand: { "@type": "Brand", name: "SIDZEN" },
    offers: { "@type": "Offer", url: `https://sidzen.shop/catalog/${category.slug}/${product.slug}/`, priceCurrency: "RUB", price: defaultPrice, availability: product.stock > 0 ? "https://schema.org/InStock" : product.madeToOrder ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock" },
    ...(reviewCount ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.toFixed(1), reviewCount } } : {}),
  };
  const specs = productSpecificationRows(product);
  const description = product.description || product.shortDescription;
  return (
    <>
      <JsonLd data={schema} />
      <Breadcrumbs visible={false} items={[{ label: "Каталог", href: "/catalog/" }, { label: category.name, href: `/catalog/${category.slug}/` }, { label: product.name, href: `/catalog/${category.slug}/${product.slug}/` }]} />
      <article className="container product-detail">
        <ProductPurchaseState product={options} key={product.id}>
          <div className="product-detail__grid">
            <div className="product-media">
              <ProductGallery key={product.id} images={product.images.map(({ path, alt, caption, width, height }) => ({ path, alt, caption, width, height }))} name={product.name} badge={product.badge} mobileActions={<FavoriteButton productId={product.id} name={product.name} />} />
              <ProductMobilePrice oldPrice={product.oldPrice ? Number(product.oldPrice) : null} />
            </div>
            <div className="product-summary">
              <div className="product-summary__heading">
                <div className="product-summary__tools"><span className="product-summary__sku">Артикул: {product.sku}</span><FavoriteButton productId={product.id} name={product.name} /></div>
                <h1>{product.h1 ?? product.name}</h1>
                <a className="product-rating" href="#reviews-heading">{reviewCount ? `★ ${rating.toFixed(1)} · ${reviewCount} ${pluralRu(reviewCount, ["отзыв", "отзыва", "отзывов"])}` : "Отзывы покупателей"}</a>
              </div>
              <ProductGroupOptions options={groupOptions} currentId={product.id} />
              {specs.length > 0 && <section className="product-overview" aria-labelledby="product-overview-heading"><div className="product-overview__heading"><h2 id="product-overview-heading">О товаре</h2><a href="#specifications">Все характеристики</a></div><dl>{specs.slice(0, 6).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>}
              <a className="product-description-link" href="#description">Перейти к описанию →</a>
            </div>
            <aside className="product-buy-panel" aria-label="Покупка товара">
              <span className={"stock-label" + (product.stock < 1 && !product.madeToOrder ? " stock-label--unavailable" : "")}>{product.stock > 0 ? `В наличии: ${product.stock} шт.` : product.madeToOrder ? `Под заказ: ${product.leadDays}–${product.leadDays + 2} ${pluralRu(product.leadDays + 2, ["день", "дня", "дней"])}` : "Нет в наличии"}</span>
              <ProductPurchaseForm product={options} />
              <Link className="product-delivery-note" href="/delivery/"><TruckIcon aria-hidden="true" /><span>Доставка в ПВЗ<small>Условия зависят от выбранного перевозчика</small></span></Link>
            </aside>
          </div>
        </ProductPurchaseState>
        <div className="content-tabs"><nav className="content-tabs__nav"><a href="#description">Описание</a>{specs.length > 0 && <a href="#specifications">Характеристики</a>}<a href="#delivery">Доставка</a></nav><div className="rich-text"><h2 id="description">Описание</h2>{description && <p className="product-description">{description}</p>}{product.usage && <p>{product.usage}</p>}{specs.length > 0 && <><h2 id="specifications">Характеристики</h2><table className="spec-table"><tbody>{specs.map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>)}</tbody></table></>}<h2 id="delivery">Доставка и уход</h2><p>Способы доставки и их стоимость можно посмотреть при оформлении заказа. {product.instructions}</p></div></div>
        <ProductReviews productId={product.id} path={`/catalog/${category.slug}/${product.slug}/`} total={reviewCount} rating={rating} requestedPage={query.reviewsPage} />
        {related.length > 0 && <section><h2>Вам также может подойти</h2><div className="product-grid">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
      </article>
    </>
  );
}
