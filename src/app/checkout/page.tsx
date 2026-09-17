import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCart } from "@/app/actions/cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CheckoutForm } from "@/components/checkout-form";
import { configurationText } from "@/lib/product-options";
import { onlinePaymentReady } from "@/lib/payments";

export const metadata: Metadata = { title: "Оформление заказа", robots: { index: false, follow: false } };
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, user, methods, params] = await Promise.all([getCart(), getCurrentUser(), prisma.deliveryMethod.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }), searchParams]);
  if (!cart?.items.length) redirect("/cart/");
  if (cart.items.some((item) => !item.available)) redirect("/cart/?error=unavailable");
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина", href: "/cart/" }, { label: "Оформление" }]} /></div><section className="container shop-page"><h1>Оформление заказа</h1><p className="muted">Проверьте состав заказа и выберите доставку. Регистрация не обязательна.</p><CheckoutForm items={cart.items.map((item) => ({ id: item.id, name: item.product?.name ?? "Товар", configuration: configurationText(item.config), quantity: item.quantity, total: item.unitPrice * item.quantity }))} methods={methods.map((method) => ({ code: method.code, name: method.name, description: method.description, basePrice: Number(method.basePrice) }))} user={{ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "" }} onlinePayment={onlinePaymentReady()} error={params.error} /></section></>;
}
