import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Вопросы и ответы", description: "Форматы моделей, расчёт цены, сроки, доставка, материалы и производство 3DPRINTA.", alternates: { canonical: "/faq/" } };

export default async function FaqPage() {
  const items = await prisma.faqItem.findMany({ where: { active: true, scope: "general" }, orderBy: { sortOrder: "asc" } });
  return <><JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) }} /><div className="container"><Breadcrumbs items={[{ label: "FAQ" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Помощь</span><h1>Вопросы и ответы</h1><p>Если ответа нет, напишите в поддержку — ответим по конкретной модели.</p></div></header><section className="section"><div className="container faq-list">{items.map((item, index) => <details className="faq-item" key={item.id} open={index === 0}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section></>;
}
