"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const orderStatuses = ["NEW", "ESTIMATING", "APPROVED", "AWAITING_PAYMENT", "PAID", "QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"] as const;

export async function updateOrderStatusAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const parsed = z.object({ orderId: z.string().min(1), status: z.enum(orderStatuses), note: z.string().trim().max(1000) }).safeParse({ orderId: formData.get("orderId"), status: formData.get("status"), note: formData.get("note") ?? "" });
  if (!parsed.success) redirect("/admin/orders/?error=invalid");
  const before = await prisma.order.findUniqueOrThrow({ where: { id: parsed.data.orderId }, select: { status: true, internalNote: true } });
  const order = await prisma.order.update({ where: { id: parsed.data.orderId }, data: { status: parsed.data.status, internalNote: parsed.data.note || undefined } });
  await writeAudit({ actorId: user.id, action: "order.status.update", entityType: "Order", entityId: order.id, before, after: { status: order.status, internalNote: order.internalNote } });
  revalidatePath("/admin/orders/");
  redirect(`/admin/orders/${order.number}/?saved=1`);
}

export async function updateTrackingAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const orderId = String(formData.get("orderId") ?? "");
  const tracking = String(formData.get("tracking") ?? "").trim().slice(0, 120);
  const shipment = await prisma.shipment.update({ where: { orderId }, data: { tracking, shippedAt: tracking ? new Date() : undefined } });
  await writeAudit({ actorId: user.id, action: "shipment.tracking.update", entityType: "Shipment", entityId: shipment.id, after: { tracking } });
  revalidatePath("/admin/orders/");
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = z.object({ name: z.string().trim().min(3).max(180), slug: z.string().trim().max(200), sku: z.string().trim().min(2).max(80), categoryId: z.string().min(1), basePrice: z.coerce.number().min(0), stock: z.coerce.number().int().min(0), shortDescription: z.string().trim().max(500), status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "HIDDEN", "ARCHIVED"]) }).safeParse({ name: formData.get("name"), slug: formData.get("slug") ?? "", sku: formData.get("sku"), categoryId: formData.get("categoryId"), basePrice: formData.get("basePrice"), stock: formData.get("stock"), shortDescription: formData.get("shortDescription") ?? "", status: formData.get("status") ?? "DRAFT" });
  if (!parsed.success) redirect("/admin/products/?error=invalid");
  const slug = parsed.data.slug ? slugify(parsed.data.slug) : slugify(parsed.data.name);
  const product = await prisma.product.create({ data: { name: parsed.data.name, slug, sku: parsed.data.sku, basePrice: parsed.data.basePrice, stock: parsed.data.stock, madeToOrder: parsed.data.stock === 0, shortDescription: parsed.data.shortDescription, status: parsed.data.status, publishedAt: parsed.data.status === "PUBLISHED" ? new Date() : undefined, h1: parsed.data.name, title: parsed.data.name, metaDescription: parsed.data.shortDescription, categories: { create: { categoryId: parsed.data.categoryId, isPrimary: true } } } });
  await writeAudit({ actorId: user.id, action: "product.create", entityType: "Product", entityId: product.id, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  redirect(`/admin/products/${product.id}/?created=1`);
}

export async function updateProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const id = String(formData.get("id") ?? "");
  const before = await prisma.product.findUniqueOrThrow({ where: { id } });
  const data = {
    name: String(formData.get("name") ?? "").trim().slice(0, 180),
    slug: slugify(String(formData.get("slug") ?? before.slug)),
    sku: String(formData.get("sku") ?? before.sku).trim().slice(0, 80),
    basePrice: Number(formData.get("basePrice")),
    oldPrice: formData.get("oldPrice") ? Number(formData.get("oldPrice")) : null,
    stock: Math.max(0, Number(formData.get("stock")) || 0),
    leadDays: Math.max(1, Number(formData.get("leadDays")) || 3),
    shortDescription: String(formData.get("shortDescription") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    metaDescription: String(formData.get("metaDescription") ?? "").trim(),
    h1: String(formData.get("h1") ?? "").trim(),
    robots: String(formData.get("robots") ?? "index,follow"),
    status: String(formData.get("status") ?? "DRAFT") as "DRAFT" | "REVIEW" | "PUBLISHED" | "HIDDEN" | "ARCHIVED",
  };
  const product = await prisma.product.update({ where: { id }, data: { ...data, publishedAt: data.status === "PUBLISHED" ? before.publishedAt ?? new Date() : before.publishedAt } });
  await writeAudit({ actorId: user.id, action: "product.update", entityType: "Product", entityId: product.id, before: { name: before.name, slug: before.slug, price: Number(before.basePrice), status: before.status }, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  revalidatePath("/catalog/");
  redirect(`/admin/products/${product.id}/?saved=1`);
}

export async function createCategoryAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) redirect("/admin/catalog/?error=category");
  const category = await prisma.category.create({ data: { name, slug: slugify(String(formData.get("slug") ?? name)), description: String(formData.get("description") ?? ""), title: name, metaDescription: String(formData.get("description") ?? ""), h1: name } });
  await writeAudit({ actorId: user.id, action: "category.create", entityType: "Category", entityId: category.id, after: { name, slug: category.slug } });
  revalidatePath("/admin/catalog/");
}

export async function createMaterialAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const name = String(formData.get("name") ?? "").trim();
  const material = await prisma.material.create({ data: { name, slug: slugify(String(formData.get("slug") ?? name)), type: String(formData.get("type") ?? "пластик"), density: Number(formData.get("density")), pricePerGram: Number(formData.get("pricePerGram")), description: String(formData.get("description") ?? "") } });
  await writeAudit({ actorId: user.id, action: "material.create", entityType: "Material", entityId: material.id, after: { name, pricePerGram: Number(material.pricePerGram) } });
  revalidatePath("/admin/catalog/");
}

export async function upsertSeoPageAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.seoWrite);
  const path = String(formData.get("path") ?? "").trim();
  if (!path.startsWith("/")) redirect("/admin/seo/?error=path");
  const data = { title: String(formData.get("title") ?? "").trim(), metaDescription: String(formData.get("metaDescription") ?? "").trim(), h1: String(formData.get("h1") ?? "").trim(), canonical: String(formData.get("canonical") ?? "").trim() || null, robots: String(formData.get("robots") ?? "index,follow"), schemaTypes: String(formData.get("schemaTypes") ?? "").split(",").map((item) => item.trim()).filter(Boolean), content: String(formData.get("content") ?? "").trim() || null };
  const page = await prisma.seoPage.upsert({ where: { path }, update: data, create: { path, ...data } });
  await writeAudit({ actorId: user.id, action: "seo.page.upsert", entityType: "SeoPage", entityId: page.id, after: { path, title: data.title, robots: data.robots } });
  revalidatePath(path);
  redirect("/admin/seo/?saved=1");
}

export async function createRedirectAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.seoWrite);
  const fromPath = String(formData.get("fromPath") ?? "").trim();
  const toPath = String(formData.get("toPath") ?? "").trim();
  if (!fromPath.startsWith("/") || !toPath.startsWith("/") || fromPath === toPath) redirect("/admin/seo/?error=redirect");
  const redirectItem = await prisma.redirect.upsert({ where: { fromPath }, update: { toPath, code: Number(formData.get("code")) || 301, active: true }, create: { fromPath, toPath, code: Number(formData.get("code")) || 301 } });
  await writeAudit({ actorId: user.id, action: "redirect.upsert", entityType: "Redirect", entityId: redirectItem.id, after: { fromPath, toPath, code: redirectItem.code } });
  revalidatePath("/admin/seo/");
}

export async function updateSettingAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.settingsWrite);
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "");
  const current = await prisma.siteSetting.findUnique({ where: { key } });
  if (!current) redirect("/admin/settings/?error=key");
  const value = typeof current.value === "number" ? Number(raw) : raw;
  await prisma.siteSetting.update({ where: { key }, data: { value } });
  await writeAudit({ actorId: user.id, action: "setting.update", entityType: "SiteSetting", entityId: current.id, before: { value: current.value }, after: { value } });
  revalidatePath("/admin/settings/");
}

export async function assignRoleAction(formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.usersWrite);
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  await prisma.userRole.upsert({ where: { userId_roleId: { userId, roleId } }, update: {}, create: { userId, roleId } });
  await writeAudit({ actorId: actor.id, action: "user.role.assign", entityType: "User", entityId: userId, after: { roleId } });
  revalidatePath("/admin/users/");
}

export async function createArticleAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.contentWrite);
  const title = String(formData.get("title") ?? "").trim();
  const rubricId = String(formData.get("rubricId") ?? "");
  if (title.length < 5 || !rubricId) redirect("/admin/content/?error=article");
  const slug = slugify(String(formData.get("slug") ?? title));
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const article = await prisma.article.create({ data: { title, slug, rubricId, excerpt, content: String(formData.get("content") ?? "").trim(), status: String(formData.get("status") ?? "DRAFT") as "DRAFT" | "REVIEW" | "PUBLISHED", h1: title, metaTitle: title, metaDescription: excerpt, authorName: user.name ?? "Команда 3DPRINTA", publishedAt: formData.get("status") === "PUBLISHED" ? new Date() : undefined } });
  await writeAudit({ actorId: user.id, action: "article.create", entityType: "Article", entityId: article.id, after: { title, slug, status: article.status } });
  revalidatePath("/blog/");
  redirect("/admin/content/?saved=1");
}
