import type { Metadata } from "next";
import Link from "next/link";
import { createProductAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Товары — управление", robots: { index: false, follow: false } };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string }> }) {
  const params = await searchParams;
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ where: params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { sku: { contains: params.q, mode: "insensitive" } }] } : {}, include: { categories: { include: { category: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.category.findMany({ where: { visible: true }, orderBy: { name: "asc" } }),
  ]);
  return <><div className="admin-header"><div><span className="eyebrow">Каталог</span><h1>Товары</h1></div><form><input name="q" placeholder="Название или артикул" defaultValue={params.q} /><button className="button button--small">Найти</button></form></div>{params.error && <p className="notice notice--danger">Проверьте поля нового товара.</p>}<div className="admin-grid"><div className="admin-card admin-card--wide"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Товар</th><th>Артикул</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><Link href={`/admin/products/${product.id}/`}><strong>{product.name}</strong></Link></td><td>{product.sku}</td><td>{product.categories.find((item) => item.isPrimary)?.category.name ?? "—"}</td><td>{formatPrice(product.basePrice)}</td><td>{product.stock}</td><td><span className="status">{product.status}</span></td></tr>)}</tbody></table></div></div><div className="admin-card admin-card--wide"><h2>Новый товар</h2><form action={createProductAction} className="form-grid"><label className="field"><span>Название</span><input name="name" required /></label><label className="field"><span>Slug (необязательно)</span><input name="slug" /></label><label className="field"><span>Артикул</span><input name="sku" required /></label><label className="field"><span>Категория</span><select name="categoryId" required>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label className="field"><span>Цена, ₽</span><input name="basePrice" type="number" min="0" step="1" required /></label><label className="field"><span>Остаток</span><input name="stock" type="number" min="0" defaultValue="0" required /></label><label className="field"><span>Статус</span><select name="status"><option value="DRAFT">Черновик</option><option value="REVIEW">На модерации</option><option value="PUBLISHED">Опубликован</option></select></label><label className="field field--full"><span>Короткое описание</span><textarea name="shortDescription" /></label><div><button className="button" type="submit">Создать товар</button></div></form></div></div></>;
}
