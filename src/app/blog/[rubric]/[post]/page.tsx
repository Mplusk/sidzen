import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { normalizePageTitle } from "@/lib/seo";

type Params = Promise<{ rubric: string; post: string }>;
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> { const { post } = await params; const article = await prisma.article.findUnique({ where: { slug: post } }); return article ? { title: normalizePageTitle(article.metaTitle ?? article.title), description: article.metaDescription ?? article.excerpt, alternates: { canonical: article.canonical ?? `/blog/guides/${article.slug}/` }, robots: article.robots } : {}; }

export default async function ArticlePage({ params }: { params: Params }) {
  const { post, rubric } = await params;
  const article = await prisma.article.findFirst({ where: { slug: post, rubric: { slug: rubric }, status: "PUBLISHED" }, include: { rubric: true } });
  if (!article) notFound();
  const schema = { "@context": "https://schema.org", "@type": "Article", headline: article.title, description: article.excerpt, datePublished: article.publishedAt?.toISOString(), dateModified: article.updatedAt.toISOString(), author: { "@type": "Organization", name: article.authorName ?? "SIDZEN" }, publisher: { "@type": "Organization", name: "SIDZEN" }, mainEntityOfPage: `https://sidzen.shop/blog/${rubric}/${post}/` };
  return <><JsonLd data={schema} /><div className="container"><Breadcrumbs items={[{ label: "Блог", href: "/blog/" }, { label: article.rubric.name, href: "/blog/" }, { label: article.title }]} /></div><article className="container prose-page"><span className="eyebrow">{article.rubric.name} · {formatDate(article.publishedAt ?? article.createdAt)}</span><h1>{article.h1 ?? article.title}</h1><p style={{ fontSize: "1.2rem" }}>{article.excerpt}</p><h2>Короткий ответ</h2>{article.content.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</article></>;
}
