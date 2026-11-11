"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, type Product } from "@prisma/client";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { removeUserRole } from "@/lib/user-role-removal";
import { arrangeProductImages, assertImageCapacity, parseProductForm, storedProductImageName, type ProductGalleryEntry } from "@/lib/product-admin";
import { guardProductWrite } from "@/lib/marketplaces/sync";
import { queueDerivedReceipt } from "@/lib/cloudkassir/lifecycle";
import { queueYooKassaSettlement } from "@/lib/yookassa/settlements";
import { categoryAiReady, getCategoryAiConfig, queueCategoryAi } from "@/lib/category-ai/config";

import { applicationStatuses, orderStatuses } from "@/lib/order-status";
import { terminalOrderStatuses } from "@/lib/privacy-retention-policy";
import { finishStockReservations, releaseUnsentStock } from "@/lib/stock-reservations";

export async function updateOrderStatusAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const parsed = z.object({ orderId: z.string().min(1), status: z.enum(orderStatuses), note: z.string().trim().max(1000) }).safeParse({ orderId: formData.get("orderId"), status: formData.get("status"), note: formData.get("note") ?? "" });
  if (!parsed.success) redirect("/admin/orders/?error=invalid");
  let statusError = "fiscal-status";
  const order = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    const before = await tx.order.findUnique({ where: { id: parsed.data.orderId }, include: { payment: true, fiscalReceipts: true, yookassaSettlement: true } });
    if (!before || before.deletedAt || before.personalDataErasedAt) { statusError = "missing"; return null; }
    if (before.kind === "APPLICATION") {
      statusError = "application-status";
      if (!applicationStatuses.some(status => status === parsed.data.status)) return null;
      // An administrator must attest to the actual completed sale. Requests
      // and intermediate statuses never grant verified-purchase reviews.
      if (parsed.data.status === "DELIVERED" && !before.purchaseConfirmedAt && formData.get("purchaseConfirmed") !== "on") return null;
    }
    if (before.fiscalReceipts.length) {
      const status = parsed.data.status;
      if (["QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED"].includes(status) && before.payment?.status !== "PAID") return null;
      if ((status === "PAID" && before.payment?.status !== "PAID") || (status === "REFUNDED" && before.payment?.status !== "REFUNDED") || (status === "CANCELED" && before.payment?.status === "PAID") || (before.fiscalReceipts.some(row => row.kind === "SETTLEMENT") && status !== "DELIVERED" && status !== "REFUNDED")) return null;
      if (status === "DELIVERED" && (formData.get("deliveryConfirmed") !== "on" || before.payment?.status !== "PAID" || before.payment.refundReviewRequired)) return null;
    }
    if (before.payment?.provider === "yookassa-online") {
      if (before.stockReviewRequired && ["IN_PROGRESS", "QUEUED", "PRINTING", "PACKED", "SHIPPED", "DELIVERED"].includes(parsed.data.status)) { statusError = "stock-status"; return null; }
      if (["IN_PROGRESS", "QUEUED", "PRINTING", "PACKED", "SHIPPED", "DELIVERED"].includes(parsed.data.status) && before.payment.status !== "PAID") return null;
      if ((parsed.data.status === "PAID" && before.payment.status !== "PAID") || (parsed.data.status === "REFUNDED" && before.payment.status !== "REFUNDED") || (parsed.data.status === "CANCELED" && before.payment.status !== "CANCELED") || (before.yookassaSettlement && !["DELIVERED", "REFUNDED"].includes(parsed.data.status))) return null;
      if (parsed.data.status === "DELIVERED") {
        if (formData.get("deliveryConfirmed") !== "on" || before.payment.refundReviewRequired) return null;
      }
    }
    if (terminalOrderStatuses.some(status => status === before.status) && !terminalOrderStatuses.some(status => status === parsed.data.status)) { statusError = "stock-status"; return null; }
    const endedReservation = await tx.orderItem.findFirst({ where: { orderId: before.id, stockReservationState: { in: ["RELEASED", "CONSUMED"] } }, select: { stockReservationState: true } });
    if (endedReservation && (endedReservation.stockReservationState === "RELEASED" ? !["CANCELED", "REFUNDED"].includes(parsed.data.status) : !["DELIVERED", "REFUNDED"].includes(parsed.data.status))) { statusError = "stock-status"; return null; }
    // No side effects until every fiscal and inventory constraint has passed.
    if (parsed.data.status === "DELIVERED" && before.fiscalReceipts.length) await queueDerivedReceipt(tx, before.id, "SETTLEMENT");
    if (parsed.data.status === "DELIVERED" && before.payment?.provider === "yookassa-online") await queueYooKassaSettlement(tx, before.id);
    if (["CANCELED", "REFUNDED"].includes(parsed.data.status)) await releaseUnsentStock(tx, before.id);
    if (parsed.data.status === "DELIVERED") await finishStockReservations(tx, before.id, "CONSUMED");
    const updated = await tx.order.update({ where: { id: before.id }, data: { status: parsed.data.status, internalNote: parsed.data.note || null, privacyClosedAt: terminalOrderStatuses.some(status => status === parsed.data.status) ? before.status === parsed.data.status ? before.privacyClosedAt ?? new Date() : new Date() : null, ...(before.kind === "APPLICATION" ? { purchaseConfirmedAt: parsed.data.status === "DELIVERED" ? before.purchaseConfirmedAt ?? new Date() : null } : {}) } });
    if (parsed.data.status === "CANCELED") await tx.cdekDeliveryJob.updateMany({ where: { shipment: { orderId: before.id }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "order.status.update", entityType: "Order", entityId: before.id, before: { status: before.status }, after: { status: updated.status, deliveryConfirmed: formData.get("deliveryConfirmed") === "on", purchaseConfirmed: Boolean(updated.purchaseConfirmedAt) } } });
    return updated;
  });
  if (!order) redirect(`/admin/orders/?error=${statusError}`);
  updateTag("catalog");
  revalidatePath("/admin/orders/");
  revalidatePath("/account", "layout");
  revalidatePath("/catalog", "layout");
  redirect(`/admin/orders/${order.number}/?saved=1`);
}

export async function updateTrackingAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const orderId = String(formData.get("orderId") ?? "");
  const tracking = String(formData.get("tracking") ?? "").trim().slice(0, 120);
  const shipment = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.deletedAt || order.personalDataErasedAt) return null;
    return tx.shipment.update({ where: { orderId }, data: { tracking, shippedAt: tracking ? new Date() : undefined } });
  });
  if (!shipment) redirect("/admin/orders/?error=missing");
  await writeAudit({ actorId: user.id, action: "shipment.tracking.update", entityType: "Shipment", entityId: shipment.id, after: { tracking } });
  revalidatePath("/admin/orders/");
  revalidatePath("/account", "layout");
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

async function storeProductImages(formData: FormData, productName: string, existingImageCount: number) {
  const files = formData.getAll("newImages").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > 10) throw new Error("images");
  assertImageCapacity(existingImageCount, files.length);
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
  assertImageCapacity(input.images.length, uploadedImages.length);
  const existingDimensions = new Map(previousImages.map((image) => [image.path, { width: image.width, height: image.height }]));
  const images = arrangeProductImages([...input.images, ...uploadedImages].map((image, sortOrder) => ({ ...image, sortOrder, ...existingDimensions.get(image.path) })), input.imageLayout);
  return {
    name: input.name,
    categoryMode: input.categoryMode,
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
    shippingWeightG: input.shippingWeightG ?? null,
    shippingLengthMm: input.shippingLengthMm ?? null,
    shippingWidthMm: input.shippingWidthMm ?? null,
    shippingHeightMm: input.shippingHeightMm ?? null,
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
  };
}

function productErrorCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "duplicate" : error instanceof Error && error.message === "duplicate-sku" ? "duplicate" : error instanceof Error && ["images", "specifications", "marketplace-busy", "ai-disabled", "stale", "reserved-stock"].includes(error.message) ? error.message : "invalid";
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = parseProductForm(formData);
  if (!parsed.success) redirect(`/admin/products/new/?error=${parsed.error}`);
  if (parsed.data.status === "PUBLISHED") await requirePermission(PERMISSIONS.productsPublish);
  let upload: Awaited<ReturnType<typeof storeProductImages>>;
  try {
    upload = await storeProductImages(formData, parsed.data.name, parsed.data.images.length);
  } catch (error) {
    redirect(`/admin/products/new/?error=${productErrorCode(error)}`);
  }

  let product: Product;
  try {
    const data = productMutationData(parsed.data, upload.entries, [], undefined, true);
    if (!data.slug) throw new Error("invalid");
    product = await prisma.$transaction(async (tx) => {
      await guardProductWrite(tx, data.sku);
      if (data.categoryMode === "AI" && !categoryAiReady(await getCategoryAiConfig(tx))) throw new Error("ai-disabled");
      const created = await tx.product.create({ data: {
      categoryMode: data.categoryMode,
      name: data.name, slug: data.slug, sku: data.sku, type: data.type, status: data.status, badge: data.badge, shortDescription: data.shortDescription, description: data.description, usage: data.usage, instructions: data.instructions, specifications: data.specifications, basePrice: data.basePrice, oldPrice: data.oldPrice, costPrice: data.costPrice, stock: data.stock, madeToOrder: data.madeToOrder, leadDays: data.leadDays, weightGrams: data.weightGrams, widthMm: data.widthMm, depthMm: data.depthMm, heightMm: data.heightMm, modelAsset: data.modelAsset, title: data.title, h1: data.h1, metaDescription: data.metaDescription, canonical: data.canonical, robots: data.robots, publishedAt: data.publishedAt,
      categories: { create: data.categoryRows }, images: { create: data.images }, materials: { connect: data.materialLinks }, colors: { connect: data.colorLinks },
      shippingWeightG: data.shippingWeightG, shippingLengthMm: data.shippingLengthMm, shippingWidthMm: data.shippingWidthMm, shippingHeightMm: data.shippingHeightMm,
      } });
      const { refreshCatalogFacets } = await import("@/lib/catalog-facets-server");
      await refreshCatalogFacets(tx, created.id);
      await queueCategoryAi(tx, created.id, data.categoryMode);
      return created;
    });
  } catch (error) {
    await removeStoredImages(upload.storedPaths);
    redirect(`/admin/products/new/?error=${productErrorCode(error)}`);
  }
  await writeAudit({ actorId: user.id, action: "product.create", entityType: "Product", entityId: product.id, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  updateTag("catalog");
  revalidatePath("/catalog/");
  redirect(`/admin/products/${product.id}/?created=1`);
}

export async function updateProductAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/products/");
  const version = String(formData.get("productVersion") ?? "");
  const expectedUpdatedAt = new Date(version);
  if (!Number.isFinite(expectedUpdatedAt.getTime()) || expectedUpdatedAt.toISOString() !== version) redirect(`/admin/products/${id}/?error=stale`);
  const originalStock = String(formData.get("originalStock") ?? "");
  const originalReservedStock = String(formData.get("originalReservedStock") ?? "");
  if (![originalStock, originalReservedStock].every((value) => /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)))) redirect(`/admin/products/${id}/?error=stale`);
  const originalBasePrice = formData.get("originalBasePrice");
  const originalOldPrice = formData.get("originalOldPrice");
  if (typeof originalBasePrice !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(originalBasePrice) || typeof originalOldPrice !== "string" || (originalOldPrice !== "" && !/^\d{1,10}(?:\.\d{1,2})?$/.test(originalOldPrice))) redirect(`/admin/products/${id}/?error=stale`);
  const parsed = parseProductForm(formData);
  if (!parsed.success) redirect(`/admin/products/${id}/?error=${parsed.error}`);
  const before = await prisma.product.findUniqueOrThrow({ where: { id }, include: { images: true, categories: { include: { category: { select: { slug: true } } } } } });
  if (parsed.data.status === "PUBLISHED" || before.status === "PUBLISHED") await requirePermission(PERMISSIONS.productsPublish);
  let upload: Awaited<ReturnType<typeof storeProductImages>>;
  try {
    upload = await storeProductImages(formData, parsed.data.name, parsed.data.images.length);
  } catch (error) {
    redirect(`/admin/products/${id}/?error=${productErrorCode(error)}`);
  }

  let product: Product;
  let removedUploadedPaths: string[] = [];
  try {
    const data = productMutationData(parsed.data, upload.entries, before.images, before.publishedAt);
    if (!data.slug) throw new Error("invalid");
    const keptPaths = new Set(data.images.map((image) => image.path));
    removedUploadedPaths = before.images.map((image) => image.path).filter((path) => !keptPaths.has(path) && storedProductImageName(path) !== null);
    const importedFieldsChanged = data.name !== before.name || data.description !== before.description || Number(data.basePrice) !== Number(before.basePrice) || (data.oldPrice == null ? null : Number(data.oldPrice)) !== (before.oldPrice == null ? null : Number(before.oldPrice)) || JSON.stringify(parsed.data.specifications) !== JSON.stringify(before.specifications) || JSON.stringify(data.images.map((image) => image.path)) !== JSON.stringify([...before.images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.path));
    product = await prisma.$transaction(async (tx) => {
      await guardProductWrite(tx, data.sku, id);
      // Lock before comparing so a concurrent reservation cannot change stock between the check and update.
      const [locked] = await tx.$queryRaw<Array<{ updatedAt: Date; stock: number; reservedStock: number; basePrice: Prisma.Decimal; oldPrice: Prisma.Decimal | null }>>`SELECT "updatedAt", "stock", "reservedStock", "basePrice", "oldPrice" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked || locked.updatedAt.getTime() !== expectedUpdatedAt.getTime() || locked.stock !== Number(originalStock) || locked.reservedStock !== Number(originalReservedStock) || !locked.basePrice.equals(originalBasePrice) || (locked.oldPrice == null ? originalOldPrice !== "" : originalOldPrice === "" || !locked.oldPrice.equals(originalOldPrice))) throw new Error("stale");
      if (data.stock < locked.reservedStock) throw new Error("reserved-stock");
      const linked = importedFieldsChanged && await tx.marketplaceListing.count({ where: { productId: id } });
      if (data.categoryMode === "AI" && !categoryAiReady(await getCategoryAiConfig(tx))) throw new Error("ai-disabled");
      const updated = await tx.product.update({ where: { id }, data: {
      categoryMode: data.categoryMode,
      ...(linked ? { marketplaceMode: "SITE" } : {}),
      name: data.name, slug: data.slug, sku: data.sku, type: data.type, status: data.status, badge: data.badge, shortDescription: data.shortDescription, description: data.description, usage: data.usage, instructions: data.instructions, specifications: data.specifications, basePrice: data.basePrice, oldPrice: data.oldPrice, costPrice: data.costPrice, stock: data.stock, madeToOrder: data.madeToOrder, leadDays: data.leadDays, weightGrams: data.weightGrams, widthMm: data.widthMm, depthMm: data.depthMm, heightMm: data.heightMm, modelAsset: data.modelAsset, title: data.title, h1: data.h1, metaDescription: data.metaDescription, canonical: data.canonical, robots: data.robots, publishedAt: data.publishedAt,
      categories: { deleteMany: {}, create: data.categoryRows }, images: { deleteMany: {}, create: data.images }, materials: { set: data.materialLinks }, colors: { set: data.colorLinks },
      shippingWeightG: data.shippingWeightG, shippingLengthMm: data.shippingLengthMm, shippingWidthMm: data.shippingWidthMm, shippingHeightMm: data.shippingHeightMm,
      } });
      const { refreshCatalogFacets } = await import("@/lib/catalog-facets-server");
      await refreshCatalogFacets(tx, id);
      await queueCategoryAi(tx, id, data.categoryMode);
      return updated;
    });
  } catch (error) {
    await removeStoredImages(upload.storedPaths);
    redirect(`/admin/products/${id}/?error=${productErrorCode(error)}`);
  }
  await writeAudit({ actorId: user.id, action: "product.update", entityType: "Product", entityId: product.id, before: { name: before.name, slug: before.slug, price: Number(before.basePrice), status: before.status }, after: { name: product.name, slug: product.slug, price: Number(product.basePrice), status: product.status } });
  for (const path of removedUploadedPaths) {
    try {
      if (await prisma.productImage.count({ where: { path } }) === 0) {
        const storedName = storedProductImageName(path);
        if (storedName) await removeStoredImages([storedName]);
      }
    } catch (error) {
      console.error("Could not clean up an unused product image", error);
    }
  }
  updateTag("catalog");
  revalidatePath("/catalog/");
  for (const category of before.categories) revalidatePath(`/catalog/${category.category.slug}/${before.slug}/`);
  redirect(`/admin/products/${product.id}/?saved=1`);
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
  if (!current || ["system", "integrations", "security"].includes(current.group) || key.startsWith("security.")) redirect("/admin/settings/?error=key");
  const value = typeof current.value === "number" ? Number(raw) : raw;
  // Do not write if this setting was moved into a protected group in parallel.
  const updated = await prisma.siteSetting.updateMany({ where: { key, group: current.group }, data: { value } });
  if (updated.count !== 1) redirect("/admin/settings/?error=key");
  await writeAudit({ actorId: user.id, action: "setting.update", entityType: "SiteSetting", entityId: current.id, before: { value: current.value }, after: { value } });
  revalidatePath("/", "layout");
}

export async function assignRoleAction(formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.usersWrite);
  const userId = String(formData.get("userId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412051)`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.userRole.findUnique({ where: { userId_roleId: { userId, roleId } } });
    if (!existing) {
      await tx.userRole.create({ data: { userId, roleId } });
      await tx.session.updateMany({ where: { userId, adminVerifiedAt: { not: null } }, data: { adminVerifiedAt: null } });
      await tx.adminLoginChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    }
    await tx.auditLog.create({ data: { actorId: actor.id, action: "user.role.assign", entityType: "User", entityId: userId, after: { roleId } } });
  });
  revalidatePath("/admin/users/");
}

export async function removeRoleAction(formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.usersWrite);
  const parsed = z.object({ userId: z.string().min(1).max(200), roleId: z.string().min(1).max(200) }).safeParse({ userId: formData.get("userId"), roleId: formData.get("roleId") });
  if (!parsed.success) redirect("/admin/users/?error=invalid");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  const result = await removeUserRole(prisma, { actorId: actor.id, ...parsed.data, ip });
  if (result !== "removed") redirect(`/admin/users/?error=${result}`);
  revalidatePath("/admin/users/");
  redirect("/admin/users/?removed=1");
}

export async function createArticleAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.contentWrite);
  const title = String(formData.get("title") ?? "").trim();
  const rubricId = String(formData.get("rubricId") ?? "");
  if (title.length < 5 || !rubricId) redirect("/admin/content/?error=article");
  const slug = slugify(String(formData.get("slug") ?? title));
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const article = await prisma.article.create({ data: { title, slug, rubricId, excerpt, content: String(formData.get("content") ?? "").trim(), status: String(formData.get("status") ?? "DRAFT") as "DRAFT" | "REVIEW" | "PUBLISHED", h1: title, metaTitle: title, metaDescription: excerpt, authorName: user.name ?? "Команда SIDZEN", publishedAt: formData.get("status") === "PUBLISHED" ? new Date() : undefined } });
  await writeAudit({ actorId: user.id, action: "article.create", entityType: "Article", entityId: article.id, after: { title, slug, status: article.status } });
  revalidatePath("/blog/");
  redirect("/admin/content/?saved=1");
}

