import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Товары — управление", robots: { index: false, follow: false } };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string }> }) {
  const user = await requirePermission(PERMISSIONS.productsRead);
  const params = await searchParams;
  const products = await prisma.product.findMany({ where: params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { sku: { contains: params.q, mode: "insensitive" } }] } : {}, include: { categories: { include: { category: true } } }, orderBy: { updatedAt: "desc" } });
  const canWrite = user.permissions.has(PERMISSIONS.productsWrite) || user.roles.includes("superadmin");
  const canPublish = user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin");
  return <><div className="admin-header"><div><span className="eyebrow">Каталог</span><h1>Товары</h1></div><div className="admin-header__actions"><form><input name="q" placeholder="Название или артикул" defaultValue={params.q} /><button className="button button--small">Найти</button></form>{canWrite && <Link className="button" href="/admin/products/new/">Добавить товар</Link>}</div></div><div className="admin-card admin-card--wide"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Товар</th><th>Артикул</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th><th /></tr></thead><tbody>{products.map((product) => { const canEdit = canWrite && (product.status !== "PUBLISHED" || canPublish); return <tr key={product.id}><td>{canEdit ? <Link href={`/admin/products/${product.id}/`}><strong>{product.name}</strong></Link> : <strong>{product.name}</strong>}</td><td>{product.sku}</td><td>{product.categories.find((item) => item.isPrimary)?.category.name ?? "—"}</td><td>{formatPrice(product.basePrice)}</td><td>{product.stock}</td><td><span className="status">{product.status}</span></td><td>{canEdit && <Link className="text-link" href={`/admin/products/${product.id}/`}>Редактировать</Link>}</td></tr>; })}</tbody></table></div></div></>;
}
