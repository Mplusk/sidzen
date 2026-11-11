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
import { getCdekConfig, requireCdek } from "@/lib/delivery/cdek-config";
import { getYooKassaConfig, yookassaReady } from "@/lib/yookassa/config";
import { operatorReady } from "@/lib/privacy";
import { groupCartItems, maxCartGroupQuantity } from "@/lib/cart-groups";
import { checkoutCart } from "@/lib/checkout-cart";
import { cartDeliveryFingerprint } from "@/lib/delivery/ozon-quote";

export const metadata: Metadata = { title: "Оформление заказа", robots: { index: false, follow: false } };
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string; reference?: string }> }) {
  const [rawCart, user, methods, params] = await Promise.all([getCart(), getCurrentUser(), prisma.deliveryMethod.findMany({ where: { active: true, deletedAt: null }, orderBy: { sortOrder: "asc" } }), searchParams]);
  if (!rawCart?.items.length) redirect("/cart/");
  const cart = checkoutCart(rawCart)!;
  if (!await operatorReady()) return <section className="container shop-page"><h1>Оформление заказа</h1><p className="notice notice--danger">Оформление временно недоступно: продавец должен заполнить сведения оператора — наименование, адрес и email — и подтвердить размещение базы данных и резервных копий в России. Товары в корзине сохранены.</p>{user && (user.roles.includes("superadmin") || user.permissions.has("settings.write")) && <Link className="button" href="/admin/settings/">Заполнить реквизиты магазина</Link>}</section>;
  const deliveryConfig = await getOzonDeliveryConfig();
  const onlinePayment = yookassaReady(await getYooKassaConfig());
  const ozonDelivery = deliveryConfig.enabled && !!deliveryConfig.checkedAt && !!deliveryConfig.shipmentMethodId;
  let cdekDelivery = false;
  try { requireCdek(await getCdekConfig()); cdekDelivery = true; } catch { /* Delivery is disabled or incomplete. */ }
  const groups = groupCartItems(cart.items);
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина", href: "/cart/" }, { label: onlinePayment ? "Оформление заказа" : "Оформление заявки" }]} /></div><section className="container shop-page"><h1>{onlinePayment ? "Оформление заказа" : "Оформление заявки"}</h1><p className="muted">Укажите получателя и выберите удобный способ доставки.</p><CheckoutForm onlinePayment={onlinePayment} holdExpiresAt={rawCart.stockHold?.expiresAt.toISOString() ?? null} cartFingerprint={cartDeliveryFingerprint(cart)} unavailableCount={rawCart.items.length - cart.items.length} items={groups.map((item) => ({ id: item.id, name: item.product?.name ?? "Товар", sku: item.product?.sku ?? "", image: item.product?.images[0]?.path ?? null, configuration: configurationText(item.config), quantity: item.quantity, maxQuantity: maxCartGroupQuantity(item, groups), members: item.members, canAdjust: Boolean(item.groupKey) && !item.stockReviewRequired, stockReviewRequired: item.stockReviewRequired, total: item.unitPrice * item.quantity }))} methods={methods.filter(method => !["ozon-delivery", "cdek-delivery", "cdek"].includes(method.code)).map((method) => ({ code: method.code, name: method.name, description: method.description, basePrice: Number(method.basePrice) }))} ozonDelivery={ozonDelivery} cdekDelivery={cdekDelivery} packingReady={cart.items.length > 0 && cart.items.every(item => [item.product?.shippingWeightG, item.product?.shippingLengthMm, item.product?.shippingWidthMm, item.product?.shippingHeightMm].every(value => !!value && value > 0))} user={{ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "" }} error={params.error} reference={params.reference} /></section></>;
}
