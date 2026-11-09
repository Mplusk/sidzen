"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateProductPriceAction, type ProductPriceState } from "@/app/actions/product-price";
import type { AdminProductRow } from "@/components/admin-products-table";

const initial: ProductPriceState = { success: false, message: "" };

export function AdminProductPriceDialog({ product, onClose }: { product: AdminProductRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateProductPriceAction, initial);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();

  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);

  return <dialog ref={dialog} className="confirm-dialog admin-product-price-dialog" aria-labelledby={titleId}
    onCancel={event => { if (pending) event.preventDefault(); }}
    onClose={() => { if (state.success) router.refresh(); onClose(); }}>
    <h2 id={titleId}>Изменить цену</h2>
    <p>{product.name} <span className="muted">· {product.sku}</span></p>
    {product.switchesToSite && <p className="notice">При изменении цены карточка перейдёт на данные сайта: импорт с маркетплейса больше не будет заменять название, описание, фотографии и цену.</p>}
    {product.hasVariants && <p className="muted">У товара есть варианты со своей ценой. Их цены не изменятся; цена для покупателя может остаться прежней.</p>}
    <form action={action} className="admin-product-price-dialog__form">
      <input type="hidden" name="id" value={product.id} />
      <input type="hidden" name="productVersion" value={product.productVersion} />
      <input type="hidden" name="originalStatus" value={product.status} />
      <input type="hidden" name="originalBasePrice" value={product.rawBasePrice} />
      <input type="hidden" name="originalOldPrice" value={product.rawOldPrice ?? ""} />
      <label className="field"><span>Цена, ₽ *</span><input name="basePrice" type="number" min="0" max="999999999" step="0.01" defaultValue={product.rawBasePrice} required autoFocus readOnly={pending || state.success} /></label>
      <label className="field"><span>Старая цена, ₽</span><input name="oldPrice" type="number" min="0" max="999999999" step="0.01" defaultValue={product.rawOldPrice ?? ""} readOnly={pending || state.success} /><small className="muted">Оставьте пустой, чтобы убрать старую цену.</small></label>
      {product.switchesToSite && !state.success && <label className="admin-product-price-dialog__consent"><input type="checkbox" name="acceptSiteMode" required disabled={pending} /> Согласен управлять данными карточки на сайте</label>}
      {state.message && <p className={`notice ${state.success ? "notice--success" : "notice--error"}`} role={state.success ? "status" : "alert"}>{state.message}</p>}
      <div className="confirm-dialog__actions"><button type="button" className="button button--outline" disabled={pending} onClick={() => dialog.current?.close()}>{state.success ? "Готово" : "Отмена"}</button>{state.message && !state.success && <button type="button" className="button button--outline" disabled={pending} onClick={() => { router.refresh(); dialog.current?.close(); }}>Обновить список</button>}{!state.success && <button className="button" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button>}</div>
    </form>
  </dialog>;
}
