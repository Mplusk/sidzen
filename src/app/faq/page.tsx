import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { JsonLd } from "@/components/json-ld";
export const metadata: Metadata = { title: "Вопросы и ответы", description: "Выбор параметров товара, отправка заявки и доставка.", alternates: { canonical: "/faq/" } };
const items = [
  ["Как выбрать материал и цвет?", "Откройте карточку товара и выберите доступные параметры. Цена пересчитывается до добавления в корзину. Подробнее о материалах — в справочнике."],
  ["Можно изменить товар в корзине?", "Да. Нажмите «Изменить параметры», выберите материал, цвет, качество и количество, затем сохраните изменения."],
  ["Как рассчитывается итог заказа?", "Вы оплачиваете только выбранные товары. Доставка для покупателя бесплатная: расходы на перевозчика берёт на себя магазин. Если цена товара изменилась до отправки формы, сайт предложит проверить новый итог."],
  ["Как отправить заявку?", "Заполните контакты и выберите желаемую доставку. Заявка поступит продавцу, который свяжется с вами и согласует дальнейшие действия. Способов оплаты на сайте нет; отправка заявки ничего не списывает. Если выбрана Ozon Доставка, отправление до выбранного ПВЗ создаётся автоматически; отгрузку согласует продавец."],
  ["Где посмотреть статус?", "Заказы, оформленные после входа в аккаунт, доступны в личном кабинете. Для гостевого заказа сохраните ссылку на страницу подтверждения в том же браузере."],
];
export default function FaqPage() {
  return <div className="container prose-page"><JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }} /><Breadcrumbs items={[{ label: "Вопросы и ответы", href: "/faq/" }]} /><h1>Вопросы и ответы</h1><div className="faq-list">{items.map(([question, answer]) => <details className="faq-item" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div><p><Link className="text-link" href="/contacts/">Контакты продавца</Link></p></div>;
}
