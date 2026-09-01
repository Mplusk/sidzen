import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const material = await prisma.material.findUnique({ where: { slug } });
  return material ? { title: material.title ?? `3D-печать ${material.name}`, description: material.metaDescription ?? material.description, alternates: { canonical: `/materials/${material.slug}/` } } : {};
}

export default async function MaterialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const material = await prisma.material.findUnique({ where: { slug }, include: { colors: { where: { active: true } }, products: { where: { status: "PUBLISHED" }, include: { images: true, categories: { include: { category: true } } }, take: 4 } } });
  if (!material) notFound();
  return <><div className="container"><Breadcrumbs items={[{ label: "Материалы", href: "/materials/" }, { label: material.name }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">{material.type}</span><h1>3D-печать из {material.name}</h1><p>{material.description}</p></div></header><section className="section"><div className="container product-detail__grid"><div className="rich-text"><h2>Когда выбирать {material.name}</h2><p><strong>Плюсы:</strong> {material.advantages}.</p><p><strong>Ограничения:</strong> {material.disadvantages}.</p><p><strong>Рабочая температура:</strong> {material.temperature}.</p><h2>Доступные цвета</h2><div className="option-row">{material.colors.map((color) => <span className="option-chip" key={color.id}><span className="color-dot" style={{ "--dot": color.hex } as React.CSSProperties} />{color.name}</span>)}</div></div><aside className="configurator__summary"><span className="eyebrow">Ориентир</span><h2>от {formatPrice(Number(material.pricePerGram) * 80 + 400)}</h2><p>Для детали массой около 80 г. На цену также влияют слой, заполнение, время и обработка.</p><ul className="summary-list"><li><span>Плотность</span><strong>{Number(material.density)} г/см³</strong></li><li><span>Материал</span><strong>{Number(material.pricePerGram)} ₽/г</strong></li><li><span>Минимальный заказ</span><strong>650 ₽</strong></li></ul><Link className="button button--light" style={{ width: "100%" }} href={`/print/?material=${material.slug}`}>Рассчитать модель</Link></aside></div></section></>;
}
