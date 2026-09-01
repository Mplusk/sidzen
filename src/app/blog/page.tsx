import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Блог о 3D-печати", description: "Материалы, технологии, подготовка моделей, стоимость и практические кейсы 3D-печати.", alternates: { canonical: "/blog/" } };

export default async function BlogPage() {
  const articles = await prisma.article.findMany({ where: { status: "PUBLISHED" }, include: { rubric: true }, orderBy: { publishedAt: "desc" } });
  return <><div className="container"><Breadcrumbs items={[{ label: "Блог" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">База знаний</span><h1>3D-печать без магии и маркетингового дыма</h1><p>Практические разборы материалов, геометрии, стоимости и производства.</p></div></header><section className="section"><div className="container editorial-grid">{articles.map((article) => <article className="article-card" key={article.id}><time>{formatDate(article.publishedAt ?? article.createdAt)} · {article.rubric.name}</time><h2 style={{ fontSize: "2rem" }}><Link href={`/blog/${article.rubric.slug}/${article.slug}/`}>{article.title}</Link></h2><p>{article.excerpt}</p><Link className="text-link" href={`/blog/${article.rubric.slug}/${article.slug}/`}>Читать статью</Link></article>)}</div></section></>;
}
