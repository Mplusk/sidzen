import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCart } from "@/app/actions/cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CheckoutForm } from "@/components/checkout-form";
import { configurationText } from "@/lib/product-options";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { operatorReady } from "@/lib/privacy";

export const metadata: Metadata = { title: "Оформление заявки", robots: { index: false, follow: false } };
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string; reference?: string }> }) {
  const [cart, user, methods, params] = await Promise.all([getCart(), getCurrentUser(), prisma.deliveryMethod.findMany({ where: { active: true, deletedAt: null }, orderBy: { sortOrder: "asc" } }), searchParams]);
  if (!cart?.items.length) redirect("/cart/");
  if (cart.items.some((item) => !item.available)) redirect("/cart/?error=unavailable");
  if (!await operatorReady()) return <section className="container shop-page"><h1>Оформление заказа</h1><p className="notice notice--danger">Оформление временно недоступно: продавец должен заполнить сведения оператора — наименование, адрес и email — и подтвердить размещение базы данных и резервных копий в России. Товары в корзине сохранены.</p>{user && (user.roles.includes("superadmin") || user.permissions.has("settings.write")) && <Link className="button" href="/admin/settings/">Заполнить реквизиты магазина</Link>}</section>;
  const deliveryConfig = await getOzonDeliveryConfig();
  const ozonDelivery = deliveryConfig.enabled && !!deliveryConfig.checkedAt && !!deliveryConfig.shipmentMethodId;
  const ozonUnavailable = !deliveryConfig.shipmentMethodId ? "Магазин завершает подключение Ozon. Пока выберите другую доставку." : "Магазин временно отключил Ozon Доставку. Выберите другой способ.";
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина", href: "/cart/" }, { label: "Оформление заявки" }]} /></div><section className="container shop-page"><h1>Оформление заявки</h1><p className="muted">Укажите контакты и выберите доставку. Продавец свяжется с вами для согласования заказа. Регистрация не обязательна.</p><CheckoutForm items={cart.items.map((item) => ({ id: item.id, name: item.product?.name ?? "Товар", configuration: configurationText(item.config), quantity: item.quantity, total: item.unitPrice * item.quantity }))} methods={methods.filter(method => method.code !== "ozon-delivery").map((method) => ({ code: method.code, name: method.name, description: method.description, basePrice: Number(method.basePrice) }))} ozonDelivery={ozonDelivery} ozonUnavailable={ozonUnavailable} packingReady={cart.items.every(item => [item.product?.shippingWeightG, item.product?.shippingLengthMm, item.product?.shippingWidthMm, item.product?.shippingHeightMm].every(value => !!value && value > 0))} user={{ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "" }} error={params.error} reference={params.reference} /></section></>;
}
