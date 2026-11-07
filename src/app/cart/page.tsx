import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCart, removeCartItem } from "@/app/actions/cart";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductPurchaseForm } from "@/components/product-purchase-form";
import { CartQuantityControl } from "@/components/cart-quantity-control";
import { configurationText } from "@/lib/product-options";
import { formatPrice, pluralRu } from "@/lib/format";

export const metadata: Metadata = { title: "Корзина", robots: { index: false, follow: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, params] = await Promise.all([getCart(), searchParams]);
  const items = cart?.items ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина" }]} /></div><section className="container shop-page"><h1>Корзина</h1><p className="muted">{items.length ? `${items.length} ${pluralRu(items.length, ["позиция", "позиции", "позиций"])} в корзине` : "Добавьте изделие из каталога."}</p>
    {params.error && <p className="notice notice--danger" role="alert">Проверьте наличие товара, количество и выбранные параметры.</p>}
    {items.length ? <div className="commerce-grid"><div className="cart-items">{items.map((item) => {
      const image = item.product?.images[0];
      const category = item.product?.categories.find((entry) => entry.isPrimary)?.category ?? item.product?.categories[0]?.category;
      return <article className="cart-item" key={item.id}>
        {image && <Image src={image.path} alt={image.alt} width={88} height={88} className="cart-item__image" />}
        <div className="cart-item__body"><h2>{item.product ? category ? <Link href={`/catalog/${category.slug}/${item.product.slug}/`}>{item.product.name}</Link> : item.product.name : "Товар недоступен"}</h2><p>{configurationText(item.config)}</p><small>{item.product?.sku} · {item.quantity} шт.</small>
          {!item.available && <p className="notice notice--danger">Эта конфигурация недоступна. Измените выбор или удалите позицию.</p>}
          {item.options && <details className="cart-item__edit"><summary>Изменить параметры и количество</summary><ProductPurchaseForm key={`${item.id}:${item.quantity}`} product={item.options} initial={item.selection} cartItemId={item.id} /></details>}
        </div><div className="cart-item__total"><CartQuantityControl id={item.id} name={item.product?.name ?? "Товар"} quantity={item.quantity} revision={item.updatedAt.toISOString()} max={item.product?.madeToOrder ? 999 : Math.min(item.product?.stock ?? 0, 999)} canAdjust={Boolean(item.quote)} /><strong>{formatPrice(item.unitPrice * item.quantity)}</strong><form action={removeCartItem}><input type="hidden" name="id" value={item.id} /><SubmitButton className="admin-delete-link" pendingLabel="Удаляем…">Удалить</SubmitButton></form></div>
      </article>;
    })}</div><aside className="order-summary"><h2>Ваш заказ</h2><div className="summary-line"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><p>Способ доставки и окончательную сумму выберете на следующем шаге.</p>{items.every((item) => item.available) && <Link className="button" href="/checkout/">Перейти к оформлению</Link>}<Link className="text-link" href="/">Продолжить покупки</Link></aside></div> : <div className="empty-state"><h2>Корзина пока пуста</h2><p>Выберите товар, материал и цвет в каталоге.</p><Link className="button" href="/">Открыть каталог</Link></div>}
  </section></>;
}
