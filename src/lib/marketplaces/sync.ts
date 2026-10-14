import { randomUUID } from "node:crypto";
import { refreshCatalogFacets } from "@/lib/catalog-facets-server";
import { Prisma, type MarketplaceSyncRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDiagnostic } from "@/lib/diagnostics";
import { slugify } from "@/lib/format";
import { getConnection, getPolicy } from "./config";
import { canonicalSnapshot, identityKeys, normalizeSku, providers, snapshotSchema, type Provider, type Snapshot } from "./model";
import { fetchPage, fetchWbPrices, MarketplaceError } from "./api";
import type { WbAttributeCache } from "./wb-measurements";
import { importImages } from "./images";
import type { OzonAttributeCache } from "./ozon-attributes";
import { getCategoryAiConfig, categoryAiReady, queueCategoryAi } from "@/lib/category-ai/config";

export const LOCK = 73412027;
const leaseDuration = 120_000;
type Tx = Prisma.TransactionClient;
export async function marketplaceLock(tx: Tx) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`; }

async function skuProducts(tx: Tx, sku: string, variants = false) {
  // Match legacy site SKUs as well as aliases, including case/spacing/NFKC.
  const value = normalizeSku(sku);
  return variants
    ? tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProductVariant" WHERE upper(regexp_replace(regexp_replace(normalize("sku", NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '[[:space:]]+', ' ', 'g')) = ${value}`
    : tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE upper(regexp_replace(regexp_replace(normalize("sku", NFKC), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '[[:space:]]+', ' ', 'g')) = ${value}`;
}

export async function guardProductWrite(tx: Tx, sku: string, productId?: string) {
  await marketplaceLock(tx);
  if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new Error("marketplace-busy");
  const key = `sku:${normalizeSku(sku)}`;
  const identity = await tx.marketplaceIdentity.findUnique({ where: { key } });
  if ((identity && identity.productId !== productId) || (await skuProducts(tx, sku)).some((row) => row.id !== productId)) throw new Error("duplicate-sku");
  if (productId && await tx.marketplaceListing.count({ where: { productId } })) await tx.marketplaceIdentity.upsert({ where: { key }, create: { key, productId }, update: {} });
}

export async function reconcileProduct(tx: Tx, productId: string, primary: Provider) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const rows = await tx.marketplaceListing.findMany({ where: { productId } });
  const canonical = canonicalSnapshot(rows, primary);
  if (!canonical) return;
  const { packaging, ...itemMeasurements } = canonical.measurements ?? {};
  if (product.marketplaceMode === "SITE") {
    // New importer fields may fill previously empty measurements, but must
    // never replace manual values or mix a partially manual parcel with Ozon.
    const missingItem = Object.fromEntries(Object.entries(itemMeasurements).filter(([key]) => product[key as keyof typeof itemMeasurements] == null));
    const missingParcel = [product.shippingWeightG, product.shippingLengthMm, product.shippingWidthMm, product.shippingHeightMm].every(value => value == null);
    if (Object.keys(missingItem).length || (missingParcel && packaging)) await tx.product.update({ where: { id: productId }, data: { ...missingItem, ...(missingParcel ? packaging : {}) } });
    return;
  }
  const oldImages = await tx.productImage.findMany({ where: { productId }, orderBy: { sortOrder: "asc" } });
  const replaceImages = canonical.images.length > 0 && JSON.stringify(oldImages.map((image) => image.path)) !== JSON.stringify(canonical.images);
  await tx.product.update({ where: { id: productId }, data: {
    name: canonical.name, basePrice: canonical.price, oldPrice: canonical.oldPrice,
    // Missing optional fields never wipe existing website information.
    ...(canonical.description ? { description: canonical.description } : {}),
    ...(canonical.specifications && Object.keys(canonical.specifications).length ? { specifications: canonical.specifications } : {}),
    ...itemMeasurements, ...packaging,
    ...(replaceImages ? { images: { deleteMany: {}, create: canonical.images.map((path, sortOrder) => ({ path, sortOrder, alt: canonical.name })) } } : {}),
  } });
}

export async function applySnapshot(tx: Tx, provider: Provider, accountId: string, snapshot: Snapshot, runId?: string) {
  const unique = { provider_accountId_externalId: { provider, accountId, externalId: snapshot.externalId } };
  const previous = await tx.marketplaceListing.findUnique({ where: unique });
  // Replaying a page after a crash does not count or mutate the item twice.
  if (runId && previous?.lastRunId === runId) return { created: 0, updated: 0, conflicts: 0, processed: 0 };
  const keys = identityKeys(snapshot);
  const identities = await tx.marketplaceIdentity.findMany({ where: { key: { in: keys } } });
  const matches = await skuProducts(tx, snapshot.sku);
  const candidates = new Set([...identities.map((row) => row.productId), ...matches.map((row) => row.id)]);
  let productId = previous?.productId ?? null;
  let conflict = snapshot.issue;
  if (productId && ["prices", "currency"].includes(conflict ?? "") && (await tx.product.findUnique({ where: { id: productId } }))?.marketplaceMode === "SITE") conflict = null;
  if (!conflict && candidates.size > 1) conflict = "identifiers";
  if (!conflict && productId && [...candidates].some((candidate) => candidate !== productId)) conflict = "identifiers";
  if (!conflict && !productId && candidates.size === 1) productId = [...candidates][0];
  if (!conflict && !previous?.productId && (await skuProducts(tx, snapshot.sku, true)).length) conflict = "variant";
  if (!conflict && productId && await tx.marketplaceListing.count({ where: { provider, accountId, productId, externalId: { not: snapshot.externalId } } })) conflict = "multiple";
  const policy = await getPolicy(tx);
  let created = 0;
  if (!conflict && !productId) {
    // WB has distinct nmIDs/SKUs for colours with identical titles. A title
    // must neither merge these identities nor prevent their creation.
    if (provider !== "wb" && await tx.product.count({ where: { name: { equals: snapshot.name, mode: "insensitive" } } })) conflict = "name";
    else {
      const categoryExists = policy.categoryId && await tx.category.findUnique({ where: { id: policy.categoryId } });
      // A draft without a category is allowed; publication requires assigning one.
      const product = await tx.product.create({ data: {
        categoryMode: categoryAiReady(await getCategoryAiConfig(tx)) ? "AI" : "MANUAL",
        name: snapshot.name, sku: normalizeSku(snapshot.sku), slug: `${slugify(snapshot.sku).slice(0, 100) || "marketplace"}-${randomUUID().slice(0, 8)}`,
        type: "READY", status: "DRAFT", basePrice: snapshot.price, oldPrice: snapshot.oldPrice, madeToOrder: false,
        ...(categoryExists ? { categories: { create: { categoryId: policy.categoryId, isPrimary: true } } } : {}),
      } });
      productId = product.id; created = 1;
    }
  }
  if (conflict && !previous?.productId) productId = null;
  const listing = await tx.marketplaceListing.upsert({ where: unique,
    create: { provider, accountId, externalId: snapshot.externalId, sellerSku: snapshot.sku, normalizedSku: normalizeSku(snapshot.sku), barcodes: snapshot.barcodes, snapshot, productId, conflict, lastRunId: runId },
    update: { sellerSku: snapshot.sku, normalizedSku: normalizeSku(snapshot.sku), barcodes: snapshot.barcodes, snapshot, productId, conflict, lastRunId: runId },
  });
  if (!conflict && productId) {
    for (const key of keys) await tx.marketplaceIdentity.upsert({ where: { key }, create: { key, productId }, update: {} });
    await reconcileProduct(tx, productId, policy.primary);
    await refreshCatalogFacets(tx, productId);
    if (created) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      await queueCategoryAi(tx, productId, product.categoryMode);
    }
    if (provider === "wb" && snapshot.group) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      if (product.groupingMode === "AUTO") {
        const sourceKey = `wb:${accountId}:${snapshot.group.id}`;
        const group = await tx.productGroup.upsert({ where: { sourceKey }, create: { name: snapshot.name, sourceKey }, update: {} });
        await tx.product.update({ where: { id: productId }, data: { groupId: group.id, groupLabel: snapshot.group.label || snapshot.sku } });
      }
    }
  }
  return { created, updated: !conflict && !created ? 1 : 0, conflicts: listing.conflict ? 1 : 0, processed: 1 };
}

// Explicit resolution cannot steal an identifier from another website product.
export async function mapListing(tx: Tx, listingId: string, productId: string) {
  const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } });
  const snapshot = snapshotSchema.parse(listing.snapshot);
  const manualPricing = ["prices", "currency"].includes(snapshot.issue ?? "");
  if (snapshot.issue && !manualPricing) throw new Error("item-issue");
  await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const keys = identityKeys(snapshot);
  const identities = await tx.marketplaceIdentity.findMany({ where: { key: { in: keys } } });
  const matches = await skuProducts(tx, snapshot.sku);
  if (identities.some((row) => row.productId !== productId) || matches.some((row) => row.id !== productId)) throw new Error("identifiers");
  if (await tx.marketplaceListing.count({ where: { provider: listing.provider, accountId: listing.accountId, productId, id: { not: listing.id } } })) throw new Error("multiple");
  // Never silently rebind an already mapped listing to another product.
  if (listing.productId && listing.productId !== productId) throw new Error("identifiers");
  for (const key of keys) await tx.marketplaceIdentity.upsert({ where: { key }, create: { key, productId }, update: {} });
  await tx.marketplaceListing.update({ where: { id: listingId }, data: { productId, conflict: null } });
  if (manualPricing || listing.conflict === "variant") await tx.product.update({ where: { id: productId }, data: { marketplaceMode: "SITE" } });
  await reconcileProduct(tx, productId, (await getPolicy(tx)).primary);
}

export async function claimRun() {
  return prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    const active = await tx.marketplaceSyncRun.findFirst({ where: { status: "RUNNING" } });
    if (active && active.leaseUntil && active.leaseUntil > new Date()) return null;
    const run = active ?? await tx.marketplaceSyncRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!run) return null;
    return tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: "RUNNING", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + leaseDuration), startedAt: run.startedAt ?? new Date() } });
  });
}
async function requireLease(tx: Tx, run: MarketplaceSyncRun) {
  const current = await tx.marketplaceSyncRun.findUniqueOrThrow({ where: { id: run.id } });
  if (current.status !== "RUNNING" || current.leaseToken !== run.leaseToken || !current.leaseUntil || current.leaseUntil < new Date()) throw new Error("lease-lost");
}
export async function processRun(run: MarketplaceSyncRun) {
  let cursor = (run.cursor ?? {}) as Record<string, unknown>;
  const heartbeat = setInterval(() => {
    void prisma.marketplaceSyncRun.updateMany({ where: { id: run.id, status: "RUNNING", leaseToken: run.leaseToken }, data: { leaseUntil: new Date(Date.now() + leaseDuration) } }).catch(() => {});
  }, 20_000);
  try {
    if (!providers.includes(run.provider as Provider)) throw new MarketplaceError("credentials");
    const provider = run.provider as Provider;
    const connection = await getConnection(provider);
    if (!connection || connection.accountId !== run.accountId) throw new MarketplaceError("credentials");
    const wbPrices = provider === "wb" ? await fetchWbPrices(connection) : undefined;
    const ozonAttributeCache: OzonAttributeCache = new Map();
    const wbAttributeCache: WbAttributeCache = new Map();
    for (;;) {
      const current = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id: run.id } });
      if (current.status !== "RUNNING" || current.leaseToken !== run.leaseToken) return;
      const page = await fetchPage(provider, connection, cursor, fetch, wbPrices, ozonAttributeCache, wbAttributeCache);
      for (const item of page.items) {
        if (!item.issue) {
          try { item.images = await importImages(item.images, provider); }
          catch { item.images = []; item.issue = "images"; await writeDiagnostic("marketplace.images", { provider }); }
        } else item.images = [];
        await prisma.$transaction(async (tx) => {
          await marketplaceLock(tx); await requireLease(tx, run);
          const counters = await applySnapshot(tx, provider, run.accountId, item, run.id);
          await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, { increment: value }])) });
        }, { timeout: 30_000 });
      }
      await prisma.$transaction(async (tx) => {
        await marketplaceLock(tx); await requireLease(tx, run);
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { cursor: page.cursor, ...(page.done ? { status: "SUCCEEDED", finishedAt: new Date(), leaseToken: null, leaseUntil: null } : {}) } });
        if (page.done) await tx.auditLog.create({ data: { actorId: run.actorId && await tx.user.findUnique({ where: { id: run.actorId } }) ? run.actorId : null, action: "marketplace.sync.complete", entityType: "MarketplaceSyncRun", entityId: run.id, after: { provider } } });
      });
      if (page.done) { await writeDiagnostic("marketplace.ok", { provider }); return; }
      cursor = page.cursor;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  } catch (error) {
    await writeDiagnostic("marketplace.failed", { ...(providers.includes(run.provider as Provider) ? { provider: run.provider as Provider } : {}), reason: error instanceof MarketplaceError ? error.message : "provider" });
    // No provider bodies, authentication headers or raw errors enter logs/UI.
    await prisma.marketplaceSyncRun.updateMany({ where: { id: run.id, status: "RUNNING", leaseToken: run.leaseToken }, data: { status: "FAILED", finishedAt: new Date(), leaseUntil: null, leaseToken: null, error: error instanceof MarketplaceError ? error.message : "database" } });
  } finally { clearInterval(heartbeat); }
}
