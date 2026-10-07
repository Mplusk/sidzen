"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { bulkProductStatusAction, type ProductBulkState } from "@/app/actions/product-bulk";
import { PRODUCT_STATUSES } from "@/lib/product-admin";

export type AdminProductRow = { id: string; name: string; sku: string; category: string; price: string; stock: number; status: string; canEdit: boolean };
const labels: Record<string, string> = { DRAFT: "Черновик", REVIEW: "На проверке", PUBLISHED: "Опубликован", HIDDEN: "Скрыт", ARCHIVED: "В архиве" };
const initial: ProductBulkState = { success: false, message: "" };

export function AdminProductsTable({ products, categories, canWrite, canPublish }: { products: AdminProductRow[]; categories: { id: string; name: string }[]; canWrite: boolean; canPublish: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState(canPublish ? "PUBLISHED" : "DRAFT");
  const [state, action, pending] = useActionState(bulkProductStatusAction, initial);
  const allRef = useRef<HTMLInputElement>(null);
  const selectable = products.filter(product => product.canEdit);
  const count = selectable.filter(product => selected.has(product.id)).length;
  const all = selectable.length > 0 && count === selectable.length;
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = count > 0 && !all; }, [count, all]);
  return <form action={action} className="admin-products-bulk" data-selection={canWrite}>
    {canWrite && <div className="admin-products-bulk__toolbar">
      <span aria-live="polite">Выбрано: <strong>{count}</strong></span>
      <label className="field">Новый статус<select name="status" value={status} onChange={event => setStatus(event.target.value)} disabled={pending}>{PRODUCT_STATUSES.filter(value => canPublish || value !== "PUBLISHED").map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      {canPublish && status === "PUBLISHED" && <label className="field">Категория для товаров без видимой категории<select name="categoryId" defaultValue="" disabled={pending}><option value="">Не назначать</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      <button className="button button--small" disabled={pending || count === 0 || count > 500} aria-busy={pending}>{pending ? "Сохраняем…" : "Применить к выбранным"}</button>
      <button className="button button--small button--outline" type="button" disabled={pending || !count} onClick={() => setSelected(new Set())}>Снять выбор</button>
      <p className="muted">До 500 товаров за раз. Меняем только статус; категории заполняем лишь там, где нет видимой. Цены, фото и остатки не меняются. Нулевой остаток не мешает публикации, но товар нельзя заказать без наличия или изготовления под заказ.</p>
    </div>}
    {state.message && <div className={`notice ${state.success ? "notice--success" : "notice--error"}`} role="status">{state.message}{state.skus?.length ? <p>Артикулы: {state.skus.join(", ")}</p> : null}</div>}
    <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Список товаров: таблица прокручивается горизонтально"><table className="data-table"><caption className="visually-hidden">Товары, артикулы, категории, цены, остатки и статусы</caption><thead><tr>
      {canWrite && <th><label><input ref={allRef} type="checkbox" aria-label="Выбрать все товары в списке" checked={all} disabled={pending || !selectable.length} onChange={event => setSelected(event.target.checked ? new Set(selectable.map(product => product.id)) : new Set())} /></label></th>}
      <th>Товар</th><th>Артикул</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th><th />
    </tr></thead><tbody>{products.map(product => <tr key={product.id} className={selected.has(product.id) ? "admin-products-bulk__selected" : undefined}>
      {canWrite && <td><label><input type="checkbox" name="productIds" value={product.id} aria-label={`Выбрать товар ${product.sku}`} checked={selected.has(product.id)} disabled={pending || !product.canEdit} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} /></label></td>}
      <td>{product.canEdit ? <Link href={`/admin/products/${product.id}/`}><strong>{product.name}</strong></Link> : <strong>{product.name}</strong>}</td>
      <td>{product.sku}</td><td>{product.category}</td><td>{product.price}</td><td>{product.stock}</td><td><span className="status" data-status={product.status}>{labels[product.status] ?? product.status}</span></td>
      <td>{product.canEdit && <><Link className="text-link" href={`/admin/products/${product.id}/`}>Редактировать</Link><br /><Link className="admin-delete-link" href={`/admin/products/${product.id}/#delete-product`}>Удалить</Link></>}</td>
    </tr>)}</tbody></table></div>
  </form>;
}
