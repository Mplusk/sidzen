import type { Metadata } from "next";
import { ProductGallery } from "@/components/product-gallery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { normalizePageTitle } from "@/lib/seo";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { addProductToCart } from "@/app/actions/cart";
import { CheckIcon, ShieldIcon, TruckIcon } from "@/components/icons";

type Params = Promise<{ category: string; product: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { product: slug, category } = await params;
  const product = await prisma.product.findUnique({ where: { slug }, include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } });
  if (!product) return {};
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
      images: { orderBy: { sortOrder: "asc" } },
      categories: { include: { category: true } },
      materials: { where: { active: true }, orderBy: { name: "asc" } },
      colors: { where: { active: true }, orderBy: { name: "asc" } },
      technologies: { where: { active: true } },
      qualityProfiles: { where: { active: true }, orderBy: { layerHeightMm: "desc" } },
      reviews: { where: { approved: true }, orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!product || product.status !== "PUBLISHED") notFound();
  const category = product.categories.find((item) => item.category.slug === categorySlug)?.category ?? product.categories.find((item) => item.isPrimary)?.category ?? product.categories[0]?.category;
  if (!category) notFound();
  const rating = product.reviews.length ? product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length : 5;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images.map((item) => `https://3dprinta.shop${item.path}`),
    description: product.shortDescription,
    sku: product.sku,
    brand: { "@type": "Brand", name: "3DPRINTA" },
    offers: { "@type": "Offer", url: `https://3dprinta.shop/catalog/${category.slug}/${product.slug}/`, priceCurrency: "RUB", price: Number(product.basePrice), availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/PreOrder" },
    ...(product.reviews.length ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating.toFixed(1), reviewCount: product.reviews.length } } : {}),
  };
  const specs = (product.specifications ?? {}) as Record<string, string>;
  return (
    <>
      <JsonLd data={schema} />
      <div className="container"><Breadcrumbs items={[{ label: "Каталог", href: "/catalog/" }, { label: category.name, href: `/catalog/${category.slug}/` }, { label: product.name }]} /></div>
      <article className="container product-detail">
        <div className="product-detail__grid">
          <ProductGallery key={product.id} images={product.images.map(({ path, alt, caption }) => ({ path, alt, caption }))} name={product.name} badge={product.badge} />
          <div className="product-summary">
            <span className="eyebrow">{category.name} · {product.sku}</span>
            <h1>{product.h1 ?? product.name}</h1>
            <p className="product-summary__lead">{product.shortDescription}</p>
            <span className="stock-label">{product.stock > 0 ? `В наличии: ${product.stock} шт.` : `Печать под заказ: ${product.leadDays}–${product.leadDays + 2} дня`}</span>
            <div className="product-price"><strong>от {formatPrice(product.basePrice)}</strong>{product.oldPrice && <s>{formatPrice(product.oldPrice)}</s>}</div>
            <form action={addProductToCart}>
              <input type="hidden" name="productId" value={product.id} />
              <div className="option-block"><h3>Материал</h3><div className="option-row">{product.materials.map((material, index) => <label className="option-chip" key={material.id}><input type="radio" name="material" value={material.slug} defaultChecked={index === 0} />{material.name}</label>)}</div></div>
              <div className="option-block"><h3>Цвет</h3><div className="option-row">{product.colors.map((color, index) => <label className="option-chip" key={color.id}><input type="radio" name="color" value={color.slug} defaultChecked={index === 0} /><span className="color-dot" style={{ "--dot": color.hex } as React.CSSProperties} />{color.name}</label>)}</div></div>
              <div className="option-block"><h3>Качество печати</h3><div className="option-row">{product.qualityProfiles.map((profile, index) => <label className="option-chip" key={profile.id}><input type="radio" name="quality" value={profile.slug} defaultChecked={index === 1 || (product.qualityProfiles.length === 1 && index === 0)} />{profile.name} · {Number(profile.layerHeightMm)} мм</label>)}</div></div>
              <div className="product-actions"><label className="field" style={{ maxWidth: 100 }}><span>Количество</span><input type="number" min="1" max="999" name="quantity" defaultValue="1" /></label><button className="button" type="submit">Добавить в корзину</button></div>
            </form>
            <div className="print-benefits"><div className="print-benefit"><ShieldIcon /><strong>Гарантия качества</strong><span>Проверка геометрии</span></div><div className="print-benefit"><TruckIcon /><strong>Доставка по РФ</strong><span>С трек-номером</span></div><div className="print-benefit"><CheckIcon /><strong>Поможем выбрать</strong><span>Материал и слой</span></div></div>
          </div>
        </div>
        <div className="content-tabs"><nav className="content-tabs__nav"><a href="#description">Описание</a><a href="#specifications">Характеристики</a><a href="#delivery">Доставка</a></nav><div className="rich-text"><h2 id="description">Описание</h2><p>{product.description}</p><p>{product.usage}</p><h2 id="specifications">Характеристики</h2><table className="spec-table"><tbody><tr><th>Технология</th><td>{product.technologies.map((item) => item.name).join(", ")}</td></tr><tr><th>Габариты</th><td>{[product.widthMm, product.depthMm, product.heightMm].map(Number).join(" × ")} мм</td></tr>{Object.entries(specs).map(([key, value]) => <tr key={key}><th>{key}</th><td>{String(value)}</td></tr>)}<tr><th>Срок изготовления</th><td>{product.stock > 0 ? "Отправка на следующий рабочий день" : `${product.leadDays}–${product.leadDays + 2} рабочих дня`}</td></tr></tbody></table><h2 id="delivery">Доставка и уход</h2><p>Отправляем СДЭК или Почтой России. Точную стоимость покажем при оформлении заказа. {product.instructions}</p></div></div>
      </article>
      <section className="cta-band"><div className="container"><div className="cta-band__inner"><h2>Продолжить покупки</h2><div className="cta-band__content"><p>Вернитесь в каталог, чтобы посмотреть другие изделия.</p><Link className="button button--light" href="/catalog/">Открыть каталог</Link></div></div></div></section>
    </>
  );
}
