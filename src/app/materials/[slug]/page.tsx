import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const material = await prisma.material.findUnique({ where: { slug, active: true } });
  return material ? { title: "Материал " + material.name, description: material.description, alternates: { canonical: "/materials/" + material.slug + "/" } } : {};
}
export default async function MaterialPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const material = await prisma.material.findUnique({ where: { slug, active: true }, include: { colors: { where: { active: true } } } });
  if (!material) notFound();
  return <div className="container prose-page"><Breadcrumbs items={[{ label: "Материалы", href: "/materials/" }, { label: material.name, href: "/materials/" + material.slug + "/" }]} /><h1>Материал {material.name}</h1><p>{material.description}</p><h2>Свойства</h2><p><strong>Преимущества:</strong> {material.advantages}</p><p><strong>Ограничения:</strong> {material.disadvantages}</p><p><strong>Температура:</strong> {material.temperature}</p><p>Свойства готового изделия зависят также от конструкции, качества печати и условий эксплуатации. Ориентируйтесь на характеристики конкретного товара.</p><h2>Цвета материала</h2><div className="option-row">{material.colors.map((color) => <span className="option-chip" key={color.id}><span className="color-dot" style={{ "--dot": color.hex } as React.CSSProperties} />{color.name}</span>)}</div><p><Link className="button" href={"/catalog/?material=" + material.slug}>Товары из {material.name}</Link></p></div>;
}
