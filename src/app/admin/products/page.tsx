import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { AdminProductsTable } from "@/components/admin-products-table";

export const metadata: Metadata = { title: "Товары — управление", robots: { index: false, follow: false } };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; deleted?: string; deleteError?: string }> }) {
  const user = await requirePermission(PERMISSIONS.productsRead);
  const params = await searchParams;
  const deleteMessages: Record<string, string> = { reserved: "Товар зарезервирован в заказах. Сначала завершите или отмените их и проверьте остатки.", confirmation: "Удаление не подтверждено. Откройте карточку и подтвердите удаление.", busy: "Дождитесь завершения синхронизации с маркетплейсами и повторите удаление.", missing: "Товар уже удалён или не найден.", permission: "Нет права удаления опубликованного товара.", failed: "Не удалось удалить товар. Попробуйте ещё раз." };
  const products = await prisma.product.findMany({ where: params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { sku: { contains: params.q, mode: "insensitive" } }] } : {}, include: { categories: { include: { category: true } } }, orderBy: { updatedAt: "desc" } });
  const canWrite = user.permissions.has(PERMISSIONS.productsWrite) || user.roles.includes("superadmin");
  const canPublish = user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin");
  const categories = canPublish ? await prisma.category.findMany({ where: { visible: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const deletionNotice = <>{params.deleted === "1" && <p role="status" className="notice notice--success">Товар полностью удалён с сайта. История заказов сохранена. Следующая синхронизация может добавить его заново.</p>}{params.deleteError && <p role="alert" className="notice notice--error">{deleteMessages[params.deleteError] ?? deleteMessages.failed}</p>}</>;
  return <>{deletionNotice}<div className="admin-header"><div><span className="eyebrow">Каталог</span><h1>Товары</h1></div><div className="admin-header__actions"><form><input type="search" name="q" aria-label="Название или артикул товара" placeholder="Название или артикул" defaultValue={params.q} /><button className="button button--small">Найти</button></form>{canWrite && <Link className="button" href="/admin/products/new/">Добавить товар</Link>}</div></div><div className="admin-card admin-card--wide"><AdminProductsTable key={params.q ?? ""} products={products.map(product => ({ id: product.id, name: product.name, sku: product.sku, category: product.categories.find(item => item.isPrimary)?.category.name ?? "—", price: formatPrice(product.basePrice), stock: product.stock, status: product.status, canEdit: canWrite && (product.status !== "PUBLISHED" || canPublish) }))} categories={categories} canWrite={canWrite} canPublish={canPublish} /></div></>;
}
