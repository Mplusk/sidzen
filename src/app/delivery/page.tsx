import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { getCdekConfig, requireCdek } from "@/lib/delivery/cdek-config";
import { getYooKassaConfig, yookassaReady } from "@/lib/yookassa/config";
export const metadata: Metadata = { title: "Доставка и заказ", description: "Доступные способы доставки и оформление заказа в SIDZEN.", alternates: { canonical: "/delivery/" } };
export default async function DeliveryPage() {
  const methods = await prisma.deliveryMethod.findMany({ where: { active: true, deletedAt: null, code: { notIn: ["cdek", "cdek-delivery", "ozon-delivery"] } }, orderBy: { sortOrder: "asc" } });
  const ozon = await getOzonDeliveryConfig();
  const onlinePayment = yookassaReady(await getYooKassaConfig());
  let cdek = false;
  try { requireCdek(await getCdekConfig()); cdek = true; } catch { /* Not available. */ }
  return <div className="container prose-page">
    <Breadcrumbs items={[{ label: "Доставка и заказ", href: "/delivery/" }]} />
    <h1>Доставка и заказ</h1><p className="notice notice--success">Стоимость доставки зависит от выбранного способа и будет показана при оформлении.</p>
    <h2>Способы доставки</h2>
    {ozon.enabled && ozon.shipmentMethodId && ozon.checkedAt && <div className="content-card"><h3>Ozon Доставка · бесплатно</h3><p>Выберите ПВЗ или постамат на карте при оформлении. Номер получателя должен быть зарегистрирован на Ozon; перед проверкой доступности доставки запросим отдельное согласие на передачу номера.</p></div>}
    {cdek && <div className="content-card"><h3>СДЭК · по тарифу перевозчика</h3><p>Выберите город, пункт выдачи и тариф. Рассчитанная стоимость добавляется к заявке и оплачивается покупателем.</p></div>}
    {methods.map(method => <div className="content-card" key={method.id}><h3>{method.name} · бесплатно</h3><p>{method.description}</p></div>)}
    <h2>Как оформить заказ</h2><p>Добавьте товары в корзину, заполните контакты и выберите доставку. {onlinePayment ? "Для оплаты заказа используется ЮKassa; если страница оплаты не открылась, проверьте статус на странице заказа. Чек направляется на ваш email. Запрос на создание отправления Ozon или СДЭК передаётся после подтверждения оплаты." : "Заявка поступит продавцу: он свяжется с вами, подтвердит наличие, сроки и согласует дальнейшие действия. Оплата на сайте не проводится. При выборе Ozon или СДЭК запрос на создание отправления до выбранного ПВЗ передаётся автоматически."} Фактическую отгрузку продавец согласует с вами.</p>
    <h2>Сроки</h2><p>Наличие указано в карточке товара; для изделий под заказ указан ориентировочный срок изготовления. Срок доставки зависит от адреса и перевозчика.{methods.some(method => method.code === "pickup") && " Для самовывоза заранее согласуйте место и время."}</p>
    <h2>Возврат и вопросы по заказу</h2><p>Условия покупки приведены в <Link className="text-link" href="/legal/offer/">оферте</Link>, сведения о продавце — на странице <Link className="text-link" href="/contacts/">контактов</Link>. При обращении укажите номер заказа.</p>
  </div>;
}

