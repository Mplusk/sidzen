import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Доставка и оплата", description: "Доставка СДЭК и Почтой России, самовывоз, СБП, карта и счёт для юридических лиц.", alternates: { canonical: "/delivery/" } };

export default async function DeliveryPage() {
  const methods = await prisma.deliveryMethod.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return <><div className="container"><Breadcrumbs items={[{ label: "Доставка и оплата" }]} /></div><div className="container prose-page"><span className="eyebrow">Условия</span><h1>Доставка и оплата</h1><h2>Способы доставки</h2>{methods.map((method) => <div className="content-card" style={{ marginBottom: 12 }} key={method.id}><h3>{method.name} · от {formatPrice(method.basePrice)}</h3><p>{method.description}. Финальная стоимость зависит от города, габаритов и тарифа перевозчика.</p></div>)}<h2>Оплата</h2><p>В первой версии доступны ручное подтверждение, СБП и счёт. Эквайринг подключается через заменяемый адаптер; платёжный callback идемпотентен и не создаёт повторный заказ.</p><h2>Сроки</h2><p>Готовые изделия отправляем на следующий рабочий день. Печать под заказ обычно занимает 3–7 рабочих дней после подтверждения модели и оплаты.</p></div></>;
}
