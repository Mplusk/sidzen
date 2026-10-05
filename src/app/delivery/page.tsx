import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { onlinePaymentReady } from "@/lib/payments";
export const metadata: Metadata = { title: "Доставка и оплата", description: "Способы доставки, стоимость и порядок оплаты заказов 3DPRINTA.", alternates: { canonical: "/delivery/" } };
export default async function DeliveryPage() {
  const methods = await prisma.deliveryMethod.findMany({ where: { active: true, deletedAt: null }, orderBy: { sortOrder: "asc" } });
  const ozon = await getOzonDeliveryConfig();
  return <div className="container prose-page">
    <Breadcrumbs items={[{ label: "Доставка и оплата", href: "/delivery/" }]} />
    <h1>Доставка и оплата</h1><p className="notice notice--success">Доставка для покупателя бесплатная. Вы оплачиваете только товары, расходы на перевозчика берёт на себя магазин.</p>
    <h2>Способы доставки</h2>
    {ozon.enabled && ozon.shipmentMethodId && ozon.checkedAt && <div className="content-card"><h3>Ozon Доставка · бесплатно</h3><p>Выберите ПВЗ или постамат на карте при оформлении. Номер получателя должен быть зарегистрирован на Ozon; перед проверкой доступности доставки запросим отдельное согласие на передачу номера.</p></div>}
    {methods.map(method => <div className="content-card" key={method.id}><h3>{method.name} · бесплатно</h3><p>{method.description}</p></div>)}
    <h2>Оплата</h2>{await onlinePaymentReady() && <p>Онлайн-оплата на защищённой странице ЮKassa. Доступные способы, включая карту и СБП, определяются настройками платёжного магазина.</p>}
    <p>Также можно оформить заказ с оплатой по счёту: дождитесь подтверждения и платёжных реквизитов продавца. Создание заказа само по себе не означает оплату.</p>
    <h2>Сроки</h2><p>Наличие и ориентировочный срок изготовления указаны в карточке каждого товара. Срок доставки зависит от адреса и перевозчика.{methods.some(method => method.code === "pickup") && " Для самовывоза заранее согласуйте место и время."}</p>
    <h2>Возврат и вопросы по заказу</h2><p>Условия покупки приведены в <Link className="text-link" href="/legal/offer/">оферте</Link>, сведения о продавце — на странице <Link className="text-link" href="/contacts/">контактов</Link>. При обращении укажите номер заказа.</p>
  </div>;
}
