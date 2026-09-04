"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, type Product } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseProductForm, type ProductGalleryEntry } from "@/lib/product-admin";

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

const productUploadDirectory = join(process.cwd(), "public", "uploads", "products");
const imageTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/avif", "avif"]]);

function productImageFile(storedName: string) {
  return join(process.cwd(), "public", "uploads", "products", storedName);
}

function validImageSignature(buffer: Buffer, type: string) {
  if (type === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (type === "image/avif") return buffer.length >= 12 && buffer.subarray(4, 8).toString() === "ftyp" && ["avif", "avis"].includes(buffer.subarray(8, 12).toString());
  return false;
}

async function storeProductImages(formData: FormData, productName: string) {
  const files = formData.getAll("newImages").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > 10) throw new Error("images");
  if (!files.length) return { entries: [] as ProductGalleryEntry[], storedPaths: [] as string[] };
  await mkdir(productUploadDirectory, { recursive: true, mode: 0o755 });
  const entries: ProductGalleryEntry[] = [];
  const storedPaths: string[] = [];

  try {
    for (const file of files) {
      const extension = imageTypes.get(file.type);
      if (!extension || file.size > 10 * 1024 * 1024) throw new Error("images");
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!validImageSignature(buffer, file.type)) throw new Error("images");
      const storedName = `${randomUUID()}.${extension}`;
      await writeFile(productImageFile(storedName), buffer, { flag: "wx", mode: 0o644 });
      storedPaths.push(storedName);
      entries.push({ path: `/uploads/products/${storedName}`, alt: `${productName}, изделие 3D-печати`, sortOrder: entries.length });
    }
    return { entries, storedPaths };
  } catch (error) {
    await Promise.all(storedPaths.map((storedName) => unlink(productImageFile(storedName)).catch(() => undefined)));
    throw error;
  }
}

async function removeStoredImages(storedPaths: string[]) {
  await Promise.all(storedPaths.map((storedName) => unlink(productImageFile(storedName)).catch(() => undefined)));
}

function optionalText(value: string) {
  return value || null;
}

function publicationDate(value: string, status: string, previous?: Date | null) {
  if (value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("invalid");
    return date;
  }
  return status === "PUBLISHED" ? previous ?? new Date() : null;
}

function productMutationData(input: Extract<ReturnType<typeof parseProductForm>, { success: true }>["data"], uploadedImages: ProductGalleryEntry[], previousImages: Array<{ path: string; width: number | null; height: number | null }> = [], previousPublishedAt?: Date | null, fillSeoDefaults = false) {
  const existingDimensions = new Map(previousImages.map((image) => [image.path, { width: image.width, height: image.height }]));
  const images = [...input.images, ...uploadedImages].map((image, sortOrder) => ({ ...image, sortOrder, ...existingDimensions.get(image.path) }));
  return {
    name: input.name,
    slug: slugify(input.slug || input.name),
    sku: input.sku,
    type: input.type,
    status: input.status,
    badge: optionalText(input.badge),
    shortDescription: optionalText(input.shortDescription),
    description: optionalText(input.description),
    usage: optionalText(input.usage),
    instructions: optionalText(input.instructions),
    specifications: input.specifications ? input.specifications as Prisma.InputJsonValue : Prisma.DbNull,
    basePrice: input.basePrice,
    oldPrice: input.oldPrice ?? null,
    costPrice: input.costPrice ?? null,
    stock: input.stock,
    madeToOrder: input.madeToOrder,
    leadDays: input.leadDays,
    weightGrams: input.weightGrams ?? null,
    widthMm: input.widthMm ?? null,
    depthMm: input.depthMm ?? null,
    heightMm: input.heightMm ?? null,
    modelAsset: optionalText(input.modelAsset),
    title: optionalText(input.title) ?? (fillSeoDefaults ? input.name : null),
    h1: optionalText(input.h1) ?? (fillSeoDefaults ? input.name : null),
    metaDescription: optionalText(input.metaDescription) ?? (fillSeoDefaults ? optionalText(input.shortDescription) : null),
    canonical: optionalText(input.canonical),
    robots: input.robots,
    publishedAt: publicationDate(input.publishedAt, input.status, previousPublishedAt),
    categoryRows: input.categoryIds.map((categoryId) => ({ categoryId, isPrimary: categoryId === input.primaryCategoryId })),
    images,
    materialLinks: input.materialIds.map((id) => ({ id })),
    colorLinks: input.colorIds.map((id) => ({ id })),
    technologyLinks: input.technologyIds.map((id) => ({ id })),
    qualityLinks: input.qualityProfileIds.map((id) => ({ id })),
    postProcessLinks: input.postProcessIds.map((id) => ({ id })),
  };
}

function productErrorCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "duplicate" : error instanceof Error && ["images", "specifications"].includes(error.message) ? error.message : "invalid";
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = parseProductForm(formData);
  if (!parsed.success) redirect(`/admin/products/new/?error=${parsed.error}`);
  let upload: Awaited<ReturnType<typeof storeProductImages>>;
  try {
    upload = await storeProductImages(formData, parsed.data.name);
  } catch (error) {
    redirect(`/admin/products/new/?error=${productErrorCode(error)}`);
  }

  let product: Product;
  try {
    const data = productMutationData(parsed.data, upload.entries, [], undefined, true);
    if (!data.slug) throw new Error("invalid");
    product = await prisma.product.create({ data: {
      name: data.name, slug: data.slug, sku: data.sku, type: data.type, status: data.status, badge: data.badge, shortDescription: data.shortDescription, description: data.description, usage: data.usage, instructions: data.instructions, specifications: data.specifications, basePrice: data.basePrice, oldPrice: data.oldPrice, costPrice: data.costPrice, stock: data.stock, madeToOrder: data.madeToOrder, leadDays: data.leadDays, weightGrams: data.weightGrams, widthMm: data.widthMm, depthMm: data.depthMm, heightMm: data.heightMm, modelAsset: data.modelAsset, title: data.title, h1: data.h1, metaDescription: data.metaDescription, canonical: data.canonical, robots: data.robots, publishedAt: data.publishedAt,
      categories: { create: data.categoryRows }, images: { create: data.images }, materials: { connect: data.materialLinks }, colors: { connect: data.colorLinks }, technologies: { connect: data.technologyLinks }, qualityProfiles: { connect: data.qualityLinks }, postProcesses: { connect: data.postProcessLinks },
    } });
  } catch (error) {
    await removeStoredImages(upload.storedPaths);
    redirect(`/admin/products/new/?error=${productErrorCode(error)}`);
  }
  await writeAudit({ actorId: user.id, action: "product.create", entityType: "Product", entityId: product.id, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  revalidatePath("/catalog/");
  redirect(`/admin/products/${product.id}/?created=1`);
}

export async function updateProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/products/");
  const parsed = parseProductForm(formData);
  if (!parsed.success) redirect(`/admin/products/${id}/?error=${parsed.error}`);
  const before = await prisma.product.findUniqueOrThrow({ where: { id }, include: { images: true, categories: { include: { category: { select: { slug: true } } } } } });
  let upload: Awaited<ReturnType<typeof storeProductImages>>;
  try {
    upload = await storeProductImages(formData, parsed.data.name);
  } catch (error) {
    redirect(`/admin/products/${id}/?error=${productErrorCode(error)}`);
  }

  let product: Product;
  try {
    const data = productMutationData(parsed.data, upload.entries, before.images, before.publishedAt);
    if (!data.slug) throw new Error("invalid");
    product = await prisma.product.update({ where: { id }, data: {
      name: data.name, slug: data.slug, sku: data.sku, type: data.type, status: data.status, badge: data.badge, shortDescription: data.shortDescription, description: data.description, usage: data.usage, instructions: data.instructions, specifications: data.specifications, basePrice: data.basePrice, oldPrice: data.oldPrice, costPrice: data.costPrice, stock: data.stock, madeToOrder: data.madeToOrder, leadDays: data.leadDays, weightGrams: data.weightGrams, widthMm: data.widthMm, depthMm: data.depthMm, heightMm: data.heightMm, modelAsset: data.modelAsset, title: data.title, h1: data.h1, metaDescription: data.metaDescription, canonical: data.canonical, robots: data.robots, publishedAt: data.publishedAt,
      categories: { deleteMany: {}, create: data.categoryRows }, images: { deleteMany: {}, create: data.images }, materials: { set: data.materialLinks }, colors: { set: data.colorLinks }, technologies: { set: data.technologyLinks }, qualityProfiles: { set: data.qualityLinks }, postProcesses: { set: data.postProcessLinks },
    } });
  } catch (error) {
    await removeStoredImages(upload.storedPaths);
    redirect(`/admin/products/${id}/?error=${productErrorCode(error)}`);
  }
  await writeAudit({ actorId: user.id, action: "product.update", entityType: "Product", entityId: product.id, before: { name: before.name, slug: before.slug, price: Number(before.basePrice), status: before.status }, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  revalidatePath("/catalog/");
  for (const category of before.categories) revalidatePath(`/catalog/${category.category.slug}/${before.slug}/`);
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
