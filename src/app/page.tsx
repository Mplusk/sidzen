import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { JsonLd } from "@/components/json-ld";
import { ArrowIcon, CheckIcon, ClockIcon, CubeIcon, ShieldIcon, TruckIcon, UploadIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "3D-печать на заказ и готовые изделия",
  description: "Готовые органайзеры, крепления и декор, а также 3D-печать по вашей STL/OBJ-модели с доставкой по России.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [categories, products, materials, articles, faq] = await Promise.all([
    prisma.category.findMany({ where: { visible: true, parentId: null }, orderBy: { sortOrder: "asc" }, take: 4 }),
    prisma.product.findMany({ where: { status: "PUBLISHED" }, include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } }, orderBy: [{ stock: "desc" }, { publishedAt: "desc" }], take: 4 }),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" }, take: 4 }),
    prisma.article.findMany({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 3 }),
    prisma.faqItem.findMany({ where: { scope: "general", active: true }, orderBy: { sortOrder: "asc" }, take: 5 }),
  ]);

  const websiteSchema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://3dprinta.shop/#organization", name: "3DPRINTA", url: "https://3dprinta.shop/", email: "hello@3dprinta.shop", telephone: "+7-800-301-30-03" },
      { "@type": "WebSite", "@id": "https://3dprinta.shop/#website", url: "https://3dprinta.shop/", name: "3DPRINTA", inLanguage: "ru-RU", publisher: { "@id": "https://3dprinta.shop/#organization" }, potentialAction: { "@type": "SearchAction", target: "https://3dprinta.shop/search/?q={search_term_string}", "query-input": "required name=search_term_string" } },
      { "@type": "FAQPage", mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) },
    ],
  };

  return (
    <>
      <JsonLd data={websiteSchema} />
      <section className="hero">
        <div className="hero__image"><Image src="/generated/hero-studio.webp" alt="Изделия 3DPRINTA: органайзер, подставка, крепление и светильник" fill priority sizes="100vw" /></div>
        <div className="container"><div className="hero__content">
          <span className="eyebrow">Производство 3D-печати</span>
          <h1>Печатаем идеи <span>в точных деталях</span></h1>
          <p>Готовые изделия для дома и мастерской — или производство по вашей 3D-модели от одной детали до серии.</p>
          <div className="hero__actions"><Link className="button" href="/print/"><UploadIcon /> Рассчитать печать</Link><Link className="button button--ghost" href="/catalog/">Смотреть каталог <ArrowIcon /></Link></div>
          <div className="hero__stats"><div><strong>от 1 дня</strong><span>срок производства</span></div><div><strong>±0,2 мм</strong><span>точность FDM</span></div><div><strong>по РФ</strong><span>доставка с треком</span></div></div>
        </div></div>
      </section>

      <div className="trust-strip"><div className="container trust-strip__inner">
        <div className="trust-item"><CubeIcon /><div><strong>Свои принтеры</strong><span>Контролируем каждый слой</span></div></div>
        <div className="trust-item"><ClockIcon /><div><strong>Оценка до запуска</strong><span>Вес, срок и цена</span></div></div>
        <div className="trust-item"><ShieldIcon /><div><strong>Закрытые модели</strong><span>Файлы доступны только вам</span></div></div>
        <div className="trust-item"><TruckIcon /><div><strong>Доставка по России</strong><span>СДЭК и Почта России</span></div></div>
      </div></div>

      <section className="section"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">Выберите задачу</span><h2>Полезные вещи, напечатанные под реальную жизнь</h2></div><Link href="/catalog/" className="text-link">Весь каталог <ArrowIcon /></Link></div>
        <div className="category-grid">
          {categories.map((category, index) => <Link className="category-card" href={`/catalog/${category.slug}/`} key={category.id}><Image src={category.image ?? "/generated/hero-studio.webp"} alt={category.name} fill sizes={index === 0 ? "(max-width: 560px) 100vw, 50vw" : "(max-width: 820px) 50vw, 25vw"} /><div className="category-card__body"><span>{category.description}</span><h3>{category.name}</h3></div></Link>)}
        </div>
      </div></section>

      <section className="section section--white"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">Готовые изделия</span><h2>Выбрали, настроили, получили</h2></div><p>Цвет, материал и качество печати можно выбрать в карточке. Для серий действует оптовая сетка.</p></div>
        <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
      </div></section>

      <section className="section section--ink"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">Печать по модели</span><h2>От файла до готовой детали — прозрачный процесс</h2></div><p>Сайт рассчитает ориентир. Оператор проверит технологичность и подтвердит финальные параметры.</p></div>
        <div className="process-grid">
          <div className="process-step"><span className="process-step__number">01</span><UploadIcon /><h3>Загрузите файл</h3><p>STL и OBJ анализируем автоматически. 3MF и STEP принимаем на проверку.</p></div>
          <div className="process-step"><span className="process-step__number">02</span><CubeIcon /><h3>Настройте печать</h3><p>Материал, цвет, слой, заполнение, масштаб, количество и обработка.</p></div>
          <div className="process-step"><span className="process-step__number">03</span><CheckIcon /><h3>Получите оценку</h3><p>Покажем габарит, примерный вес, время и цену. Финал подтвердит оператор.</p></div>
          <div className="process-step"><span className="process-step__number">04</span><TruckIcon /><h3>Заберите заказ</h3><p>Статусы доступны в кабинете, после отправки добавим трек-номер.</p></div>
        </div>
        <div style={{ marginTop: 34 }}><Link className="button button--light" href="/print/">Загрузить модель <ArrowIcon /></Link></div>
      </div></section>

      <section className="section"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">Материалы</span><h2>Подберём пластик под нагрузку и среду</h2></div><Link href="/materials/" className="text-link">Сравнить материалы <ArrowIcon /></Link></div>
        <div className="material-grid">{materials.map((material, index) => <Link href={`/materials/${material.slug}/`} className="material-card" style={{ "--material-color": ["#ff6a2a", "#285de8", "#2f7354", "#7255bd"][index] } as React.CSSProperties} key={material.id}><span className="material-card__code">{material.name}</span><h3>{material.type}</h3><p>{material.description}</p><ul><li>Плотность: {Number(material.density)} г/см³</li><li>{material.temperature}</li><li>от {Number(material.pricePerGram)} ₽/г</li></ul></Link>)}</div>
      </div></section>

      <section className="section section--white"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">База знаний</span><h2>Как принять инженерное решение до печати</h2></div><Link href="/blog/" className="text-link">Все материалы <ArrowIcon /></Link></div>
        <div className="editorial-grid">{articles.map((article) => <article className="article-card" key={article.id}><time>{formatDate(article.publishedAt ?? article.createdAt)}</time><h3><Link href={`/blog/guides/${article.slug}/`}>{article.title}</Link></h3><p>{article.excerpt}</p><Link href={`/blog/guides/${article.slug}/`} className="text-link">Читать <ArrowIcon /></Link></article>)}</div>
      </div></section>

      <section className="section"><div className="container">
        <div className="section-heading"><div><span className="eyebrow">FAQ</span><h2>Коротко о заказе</h2></div></div>
        <div className="faq-list">{faq.map((item, index) => <details className="faq-item" key={item.id} open={index === 0}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </div></section>

      <section className="cta-band"><div className="container"><div className="cta-band__inner"><h2>Есть модель или только идея?</h2><div className="cta-band__content"><p>Загрузите файл для расчёта или опишите задачу. Если модель требует доработки, менеджер предложит следующий шаг.</p><Link className="button button--light" href="/print/">Начать расчёт <ArrowIcon /></Link></div></div></div></section>
    </>
  );
}
