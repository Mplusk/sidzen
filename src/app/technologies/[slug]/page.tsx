import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const item = await prisma.technology.findUnique({ where: { slug } }); return item ? { title: item.title ?? `${item.name} 3D-печать`, description: item.metaDescription ?? item.description, alternates: { canonical: `/technologies/${item.slug}/` } } : {}; }

export default async function TechnologyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const technology = await prisma.technology.findUnique({ where: { slug } });
  if (!technology) notFound();
  return <><div className="container"><Breadcrumbs items={[{ label: "Технологии", href: "/technologies/" }, { label: technology.name }]} /></div><div className="container prose-page"><span className="eyebrow">Технология</span><h1>{technology.name}</h1><p>{technology.description}</p><h2>Точность и применение</h2><p><strong>Ориентир:</strong> {technology.accuracy}. Реальный допуск зависит от габарита, материала, ориентации и геометрии.</p><p>{technology.applications}</p><h2>Что получаете</h2><ul><li>Проверку модели до запуска.</li><li>Согласованный материал, слой и заполнение.</li><li>Прозрачный статус производства.</li></ul><Link className="button" href={`/print/?technology=${technology.slug}`}>Рассчитать печать</Link></div></>;
}
