import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCart, removeCartGroup } from "@/app/actions/cart";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CartQuantityControl } from "@/components/cart-quantity-control";
import { configurationText } from "@/lib/product-options";
import { formatPrice, pluralRu } from "@/lib/format";
import { groupCartItems } from "@/lib/cart-groups";

export const metadata: Metadata = { title: "Корзина", robots: { index: false, follow: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, params] = await Promise.all([getCart(), searchParams]);
  const items = groupCartItems(cart?.items ?? []);
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина" }]} /></div><section className="container shop-page"><h1>Корзина</h1><p className="muted">{items.length ? `${items.length} ${pluralRu(items.length, ["позиция", "позиции", "позиций"])} в корзине` : "Добавьте изделие из каталога."}</p>
    {params.error && <p className="notice notice--danger" role="alert">Проверьте наличие товара, количество и выбранные параметры.</p>}
    {items.length ? <div className="commerce-grid"><div className="cart-items">{items.map((item) => {
      const image = item.product?.images[0];
      const category = item.product?.categories.find((entry) => entry.isPrimary)?.category ?? item.product?.categories[0]?.category;
      return <article className="cart-item" key={item.id}>
        {image && <Image src={image.path} alt={image.alt} width={88} height={88} className="cart-item__image" />}
        <div className="cart-item__body"><h2>{item.product ? category ? <Link href={`/catalog/${category.slug}/${item.product.slug}/`}>{item.product.name}</Link> : item.product.name : "Товар недоступен"}</h2><p>{configurationText(item.config)}</p><small>{item.product?.sku} · {item.quantity} шт.</small>
          {!item.available && <p className="notice notice--danger">{item.stockReviewRequired ? "Наличие товара уточняется. Попробуйте позже или свяжитесь с магазином." : "Эта конфигурация недоступна. Удалите позицию и выберите товар заново."}</p>}
          {!item.groupKey && item.available && <p className="muted">Чтобы изменить количество, удалите позицию и добавьте товар заново.</p>}
        </div><div className="cart-item__total"><CartQuantityControl members={item.members} name={item.product?.name ?? "Товар"} quantity={item.quantity} max={item.product?.madeToOrder ? 999 : Math.max(0, Math.min((item.options?.stock ?? 0) - items.filter(other => other.id !== item.id && other.productId === item.productId).reduce((sum, other) => sum + other.quantity, 0), 999))} canAdjust={Boolean(item.quote && item.groupKey) && !item.stockReviewRequired} /><strong>{formatPrice(item.unitPrice * item.quantity)}</strong><form action={removeCartGroup}><input type="hidden" name="members" value={JSON.stringify(item.members)} /><SubmitButton className="admin-delete-link" pendingLabel="Удаляем…">Удалить</SubmitButton></form></div>
      </article>;
    })}</div><aside className="order-summary"><h2>Ваш заказ</h2><div className="summary-line"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><p>Способ доставки и окончательную сумму выберете на следующем шаге.</p>{items.every((item) => item.available) && <Link className="button" href="/checkout/">Перейти к оформлению</Link>}<Link className="text-link" href="/">Продолжить покупки</Link></aside></div> : <div className="empty-state"><h2>Корзина пока пуста</h2><p>Выберите товар, материал и цвет в каталоге.</p><Link className="button" href="/">Открыть каталог</Link></div>}
  </section></>;
}

