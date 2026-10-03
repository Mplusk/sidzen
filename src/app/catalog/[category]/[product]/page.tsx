import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { defaultSelection, priceProduct } from "@/lib/product-options";
import { ProductGallery } from "@/components/product-gallery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizePageTitle } from "@/lib/seo";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { ProductPurchaseForm } from "@/components/product-purchase-form";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { pluralRu } from "@/lib/format";
import { productSpecificationRows } from "@/lib/product-specifications";
import { CheckIcon, ShieldIcon, TruckIcon } from "@/components/icons";

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

export default async function ProductPage({ params }: { params: Params }) {
  const { product: slug, category: categorySlug } = await params;
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      ...productOptionInclude,
      images: { orderBy: { sortOrder: "asc" } },
      categories: { include: { category: true } },
      materials: { where: { active: true }, orderBy: { name: "asc" } },
      colors: { where: { active: true }, orderBy: { name: "asc" } },
      technologies: { where: { active: true } },
      qualityProfiles: { where: { active: true }, orderBy: { layerHeightMm: "desc" } },
      reviews: { where: { approved: true }, orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!product || product.status !== "PUBLISHED" || (product.type !== "READY" && product.type !== "PARAMETRIC")) notFound();
  const category = product.categories.find((item) => item.category.slug === categorySlug)?.category ?? product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  if (!category || !category.visible || !product.categories.some((item) => item.category.slug === categorySlug)) notFound();
  const related = await prisma.product.findMany({ where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, id: { not: product.id }, categories: { some: { categoryId: category.id } } }, include: { images: { orderBy: { sortOrder: "asc" } }, categories: { include: { category: true } } }, take: 4 });
  const options = productOptions(product);
  const defaultPrice = priceProduct(options, defaultSelection(options)).unitPrice;
  const rating = product.reviews.length ? product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length : 5;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images.map((item) => `https://3dprinta.shop${item.path}`),
    description: product.shortDescription,
    sku: product.sku,
    brand: { "@type": "Brand", name: "3DPRINTA" },
    offers: { "@type": "Offer", url: `https://3dprinta.shop/catalog/${category.slug}/${product.slug}/`, priceCurrency: "RUB", price: defaultPrice, availability: product.stock > 0 ? "https://schema.org/InStock" : product.madeToOrder ? "https://schema.org/PreOrder" : "https://schema.org/OutOfStock" },
    ...(product.reviews.length ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.toFixed(1), reviewCount: product.reviews.length } } : {}),
  };
  const specs = productSpecificationRows(product);
  return (
    <>
      <JsonLd data={schema} />
      <div className="container"><Breadcrumbs items={[{ label: "Каталог", href: "/catalog/" }, { label: category.name, href: `/catalog/${category.slug}/` }, { label: product.name, href: `/catalog/${category.slug}/${product.slug}/` }]} /></div>
      <article className="container product-detail">
        <div className="product-detail__grid">
          <ProductGallery key={product.id} images={product.images.map(({ path, alt, caption }) => ({ path, alt, caption }))} name={product.name} badge={product.badge} />
          <div className="product-summary">
            <span className="eyebrow">{category.name} · {product.sku}</span>
            <h1>{product.h1 ?? product.name}</h1>
            <p className="product-summary__lead">{product.shortDescription}</p>
            <span className="stock-label">{product.stock > 0 ? `В наличии: ${product.stock} шт.` : product.madeToOrder ? `Под заказ: ${product.leadDays}–${product.leadDays + 2} ${pluralRu(product.leadDays + 2, ["день", "дня", "дней"])}` : "Нет в наличии"}</span>
            <ProductPurchaseForm product={options} />
            <div className="print-benefits"><div className="print-benefit"><ShieldIcon /><strong>Гарантия качества</strong><span>Проверка геометрии</span></div><div className="print-benefit"><TruckIcon /><strong>Доставка по РФ</strong><span>С трек-номером</span></div><div className="print-benefit"><CheckIcon /><strong>Поможем выбрать</strong><span>Материал и слой</span></div></div>
          </div>
        </div>
        <div className="content-tabs"><nav className="content-tabs__nav"><a href="#description">Описание</a>{specs.length > 0 && <a href="#specifications">Характеристики</a>}<a href="#delivery">Доставка</a></nav><div className="rich-text"><h2 id="description">Описание</h2>{product.description && <p className="product-description">{product.description}</p>}{product.usage && <p>{product.usage}</p>}{specs.length > 0 && <><h2 id="specifications">Характеристики</h2><table className="spec-table"><tbody>{specs.map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>)}</tbody></table></>}<h2 id="delivery">Доставка и уход</h2><p>Отправляем СДЭК или Почтой России. Точную стоимость покажем при оформлении заказа. {product.instructions}</p></div></div>
        <section aria-labelledby="reviews-heading"><h2 id="reviews-heading">Отзывы покупателей</h2>{product.reviews.length ? product.reviews.map((review) => <article className="review-card" key={review.id}><strong>{review.author} · {review.rating}/5</strong><p>{review.text}</p><small>{review.createdAt.toLocaleDateString("ru-RU")}</small></article>) : <p>Опубликованных отзывов пока нет.</p>}</section>
        {related.length > 0 && <section><h2>Вам также может подойти</h2><div className="product-grid">{related.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
      </article>
      <section className="cta-band"><div className="container"><div className="cta-band__inner"><h2>Продолжить покупки</h2><div className="cta-band__content"><p>Вернитесь в каталог, чтобы посмотреть другие изделия.</p><Link className="button button--light" href="/catalog/">Открыть каталог</Link></div></div></div></section>
    </>
  );
}
