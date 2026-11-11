import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCart, removeCartGroup, startCheckout } from "@/app/actions/cart";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CartQuantityControl } from "@/components/cart-quantity-control";
import { CartAvailabilityRefresh } from "@/components/cart-availability-refresh";
import { configurationText } from "@/lib/product-options";
import { formatPrice, pluralRu } from "@/lib/format";
import { groupCartItems, maxCartGroupQuantity } from "@/lib/cart-groups";
import { getGuestPendingOrders } from "@/lib/guest-pending-orders";
import { ContinuePayment } from "@/components/continue-payment";

export const metadata: Metadata = { title: "Корзина", robots: { index: false, follow: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, pendingOrders, params] = await Promise.all([getCart(), getGuestPendingOrders(), searchParams]);
  const items = groupCartItems(cart?.items ?? []);
  const availableItems = items.filter(item => item.available);
  const subtotal = availableItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return <><CartAvailabilityRefresh /><div className="container"><Breadcrumbs items={[{ label: "Корзина" }]} /></div><section className="container shop-page"><h1>Корзина</h1><p className="muted">{items.length ? `${items.length} ${pluralRu(items.length, ["позиция", "позиции", "позиций"])} в корзине` : "Добавьте изделие из каталога."}</p>
    {params.error && <p className="notice notice--danger" role="alert">Проверьте наличие товара, количество и выбранные параметры.</p>}
    {pendingOrders.map(order => <section className="admin-card" key={order.id} style={{ marginBottom: 20 }}><h2>Заказ ожидает оплаты</h2><p>Заказ <Link href={`/checkout/success/${order.number}/`}>{order.number}</Link> · {formatPrice(order.total)}</p><ContinuePayment order={order} /></section>)}
    {items.length ? <div className="commerce-grid"><div className="cart-items">{items.map((item) => {
      const image = item.product?.images[0];
      const category = item.product?.categories.find((entry) => entry.isPrimary)?.category ?? item.product?.categories[0]?.category;
      const maximum = maxCartGroupQuantity(item, items);
      const canAdjust = Boolean(item.quote && item.groupKey) && !item.stockReviewRequired && maximum > 0;
      return <article className={`cart-item${item.available ? "" : " cart-item--unavailable"}`} key={item.id}>
        {image && <Image src={image.path} alt={image.alt} width={88} height={88} className="cart-item__image" />}
        <div className="cart-item__body"><h2>{item.product ? item.available && category ? <Link href={`/catalog/${category.slug}/${item.product.slug}/`}>{item.product.name}</Link> : item.product.name : "Товар недоступен"}</h2><p>{configurationText(item.config)}</p><small>{item.product?.sku} · {item.quantity} шт.</small>
          {!item.available && <p className="cart-item__availability">{canAdjust ? "Доступно меньшее количество. Измените количество или удалите товар." : "Товар недоступен и не войдёт в заказ."}</p>}
          {!item.groupKey && item.available && <p className="muted">Чтобы изменить количество, удалите позицию и добавьте товар заново.</p>}
        </div><div className="cart-item__total">{canAdjust && <CartQuantityControl members={item.members} name={item.product?.name ?? "Товар"} quantity={item.quantity} max={maximum} canAdjust />}<strong>{formatPrice(item.unitPrice * item.quantity)}</strong><form action={removeCartGroup}><input type="hidden" name="members" value={JSON.stringify(item.members)} /><SubmitButton className="admin-delete-link" pendingLabel="Удаляем…">Удалить</SubmitButton></form></div>
      </article>;
    })}</div><aside className="order-summary"><h2>Ваш заказ</h2><div className="summary-line"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div>{availableItems.length ? <form action={startCheckout}><SubmitButton className="button cart-start-checkout" pendingLabel="Переходим…">ОФОРМИТЬ ЗАКАЗ</SubmitButton></form> : <button className="button" disabled>ОФОРМИТЬ ЗАКАЗ</button>}<Link className="text-link" href="/">Продолжить покупки</Link></aside></div> : <div className="empty-state"><h2>Корзина пока пуста</h2><p>Выберите товар, материал и цвет в каталоге.</p><Link className="button" href="/">Открыть каталог</Link></div>}
  </section></>;
}
