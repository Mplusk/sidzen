import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
import { faqItems } from "@/lib/faq-content";
import { getYooKassaConfig, yookassaReady } from "@/lib/yookassa/config";
export const metadata: Metadata = { title: "Вопросы и ответы", description: "Выбор товара, оформление заказа, оплата и доставка.", alternates: { canonical: "/faq/" } };
export default async function FaqPage() {
  const items = faqItems(yookassaReady(await getYooKassaConfig()));
  return <div className="container prose-page"><JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }} /><Breadcrumbs items={[{ label: "Вопросы и ответы", href: "/faq/" }]} /><h1>Вопросы и ответы</h1><div className="faq-list">{items.map(([question, answer]) => <details className="faq-item" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div><p><Link className="text-link" href="/contacts/">Контакты продавца</Link></p></div>;
}

