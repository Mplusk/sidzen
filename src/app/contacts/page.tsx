import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata: Metadata = { title: "Контакты", description: "Связаться с 3DPRINTA по заказу, модели или сотрудничеству.", alternates: { canonical: "/contacts/" } };

export default function ContactsPage() {
  return <><div className="container"><Breadcrumbs items={[{ label: "Контакты" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Связаться</span><h1>Расскажите о задаче</h1><p>Для точной оценки приложите модель, габариты, материал, количество и желаемый срок.</p></div></header><section className="section"><div className="container product-detail__grid"><div className="configurator__panel"><h2>Контакты</h2><p><strong>Телефон:</strong> <a className="text-link" href="tel:+78003013003">8 800 301-30-03</a></p><p><strong>Заказы:</strong> <a className="text-link" href="mailto:hello@3dprinta.shop">hello@3dprinta.shop</a></p><p><strong>Поддержка:</strong> <a className="text-link" href="mailto:support@3dprinta.shop">support@3dprinta.shop</a></p><p>Рабочие дни: 9:00–19:00 МСК. География: Россия.</p></div><div className="configurator__summary"><span className="eyebrow">Быстрее всего</span><h2>Загрузить модель</h2><p>Конфигуратор сразу покажет размеры и предварительный расчёт. Комментарий попадёт оператору вместе с файлом.</p><Link className="button button--light" href="/print/">Перейти к расчёту</Link></div></div></section></>;
}
