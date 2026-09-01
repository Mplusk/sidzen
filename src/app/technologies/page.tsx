import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Технологии 3D-печати", description: "FDM/FFF и SLA/MSLA: точность, материалы, применение и ограничения.", alternates: { canonical: "/technologies/" } };

export default async function TechnologiesPage() {
  const technologies = await prisma.technology.findMany({ where: { active: true } });
  return <><div className="container"><Breadcrumbs items={[{ label: "Технологии" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Процесс</span><h1>Технология под задачу, а не наоборот</h1><p>Сопоставляем геометрию, допуск, поверхность, серию и бюджет.</p></div></header><section className="section"><div className="container content-grid">{technologies.map((technology, index) => <Link className="content-card" href={`/technologies/${technology.slug}/`} key={technology.id}><span className="content-card__number">0{index + 1}</span><h2 style={{ fontSize: "2.2rem" }}>{technology.name}</h2><p>{technology.description}</p><p><strong>Точность:</strong> {technology.accuracy}</p><p><strong>Для чего:</strong> {technology.applications}</p></Link>)}</div></section></>;
}
