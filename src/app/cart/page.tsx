import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCart, removeCartItem } from "@/app/actions/cart";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Корзина", robots: { index: false, follow: false } };

export default async function CartPage() {
  const cart = await getCart();
  const items = cart?.items ?? [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
  return <><div className="container"><Breadcrumbs items={[{ label: "Корзина" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Заказ</span><h1>Корзина</h1><p>{items.length ? `${items.length} позиций готовы к оформлению.` : "Добавьте изделие из каталога."}</p></div></header><section className="section"><div className="container">{items.length ? <div className="product-detail__grid"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Позиция</th><th>Количество</th><th>Цена</th><th /></tr></thead><tbody>{items.map((item) => { const image = item.product?.images[0]; return <tr key={item.id}><td><div style={{ display: "flex", alignItems: "center", gap: 14 }}>{image && <Image src={image.path} alt={image.alt} width={72} height={72} style={{ borderRadius: 8, objectFit: "cover" }} />}<div><strong>{item.product?.name ?? `Индивидуальное изделие ${item.modelFile?.originalName ?? ""}`}</strong><br /><small className="muted">{item.product?.sku ?? "Индивидуальный заказ"}</small></div></div></td><td>{item.quantity}</td><td><strong>{formatPrice(Number(item.unitPrice) * item.quantity)}</strong></td><td><form action={removeCartItem}><input type="hidden" name="id" value={item.id} /><button className="button button--small button--ghost" type="submit">Удалить</button></form></td></tr>; })}</tbody></table></div><aside className="configurator__summary"><span className="eyebrow">Итого</span><div className="quote-total"><span>Товары</span><strong>{formatPrice(subtotal)}</strong></div><p>Доставка рассчитывается на следующем шаге.</p><Link className="button button--light" style={{ width: "100%" }} href="/checkout/">Перейти к оформлению</Link><Link className="button button--ghost" style={{ width: "100%", marginTop: 10, color: "white", borderColor: "#69778a" }} href="/catalog/">Продолжить покупки</Link></aside></div> : <div className="empty-state"><h2>Корзина пока пуста</h2><p>Выберите товар, его материал и цвет в каталоге.</p><Link className="button" href="/catalog/">Открыть каталог</Link></div>}</div></section></>;
}
