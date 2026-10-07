"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { addProductToCart, updateCartItem } from "@/app/actions/cart";
import { defaultSelection, priceProduct, type ProductOptions, type ProductSelection } from "@/lib/product-options";
import { formatPrice } from "@/lib/format";

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return <button className="button" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Сохраняем…" : editing ? "Сохранить выбор" : "Добавить в корзину"}</button>;
}

export function ProductPurchaseForm({ product, initial, cartItemId }: { product: ProductOptions; initial?: ProductSelection; cartItemId?: string }) {
  const [selection, setSelection] = useState(initial ?? defaultSelection(product));
  const quote = priceProduct(product, selection);
  const disabled = !product.madeToOrder && product.stock < selection.quantity;
  return <form action={cartItemId ? updateCartItem : addProductToCart} className="purchase-form">
    <input type="hidden" name="productId" value={product.id} />
    {cartItemId && <input type="hidden" name="id" value={cartItemId} />}
    <div className="product-price" aria-live="polite" aria-atomic="true"><strong>{formatPrice(quote.total)}</strong><span>{selection.quantity > 1 ? `${selection.quantity} × ${formatPrice(quote.unitPrice)}` : "за 1 шт."}</span></div>
    {product.materials.length > 0 && <fieldset className="option-block"><legend>Материал</legend><div className="option-row">{product.materials.map((item) => <label className="option-chip" key={item.id}><input type="radio" name="material" value={item.slug} checked={selection.material === item.slug} onChange={() => setSelection({ ...selection, material: item.slug })} />{item.name}</label>)}</div></fieldset>}
    {product.colors.length > 0 && <fieldset className="option-block"><legend>Цвет</legend><div className="option-row">{product.colors.map((item) => <label className="option-chip" key={item.id}><input type="radio" name="color" value={item.slug} checked={selection.color === item.slug} onChange={() => setSelection({ ...selection, color: item.slug })} /><span className="color-dot" style={{ "--dot": item.hex } as React.CSSProperties} aria-hidden="true" />{item.name}</label>)}</div></fieldset>}
    {product.qualities.length > 0 && <fieldset className="option-block"><legend>Качество</legend><div className="option-row">{product.qualities.map((item) => <label className="option-chip" key={item.id}><input type="radio" name="quality" value={item.slug} checked={selection.quality === item.slug} onChange={() => setSelection({ ...selection, quality: item.slug })} />{item.name} · {item.layerHeightMm} мм</label>)}</div></fieldset>}
    <div className="product-actions"><label className="field"><span>Количество</span><input name="quantity" type="number" min="1" max="999" value={selection.quantity} onChange={(event) => setSelection({ ...selection, quantity: Math.max(1, Math.min(999, Math.floor(Number(event.target.value) || 1))) })} /></label>{!disabled && <Submit editing={Boolean(cartItemId)} />}</div>
    {disabled && <p className="notice" role="status">{product.stock > 0 ? `Доступно ${product.stock} шт. Уменьшите количество.` : "Товар временно отсутствует в наличии."}</p>}
  </form>;
}
