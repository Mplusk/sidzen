import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
export const metadata: Metadata = { title: "Вопросы и ответы", description: "Выбор параметров товара, корзина, оплата и доставка.", alternates: { canonical: "/faq/" } };
const items = [
  ["Как выбрать материал и цвет?", "Откройте карточку товара и выберите доступные параметры. Цена пересчитывается до добавления в корзину. Подробнее о материалах — в справочнике."],
  ["Можно изменить товар в корзине?", "Да. Нажмите «Изменить параметры», выберите материал, цвет, качество и количество, затем сохраните изменения."],
  ["Как рассчитывается итог заказа?", "Итог состоит из стоимости выбранных товаров и доставки. Цена доставки сразу отображается при выборе способа. Если цена изменилась до отправки формы, сайт предложит проверить новый итог."],
  ["Как оплатить заказ?", "Выберите доступный способ при оформлении. Для оплаты по счёту дождитесь подтверждения продавца. Онлайн-оплата показывается только после подключения платёжного сервиса."],
  ["Где посмотреть статус?", "Заказы, оформленные после входа в аккаунт, доступны в личном кабинете. Для гостевого заказа сохраните ссылку на страницу подтверждения в том же браузере."],
];
export default function FaqPage() {
  return <div className="container prose-page"><JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }} /><Breadcrumbs items={[{ label: "Вопросы и ответы", href: "/faq/" }]} /><h1>Вопросы и ответы</h1><div className="faq-list">{items.map(([question, answer]) => <details className="faq-item" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div><p><Link className="text-link" href="/contacts/">Контакты продавца</Link></p></div>;
}
