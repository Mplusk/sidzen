"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { encryptSecret } from "@/lib/integration-secrets";
import { rateLimit } from "@/lib/rate-limit";
import { getConnection } from "@/lib/marketplaces/config";
import { checkConnection } from "@/lib/marketplaces/api";
import { connectionKey, policySchema, POLICY_KEY, providers } from "@/lib/marketplaces/model";
import { mapListing, marketplaceLock } from "@/lib/marketplaces/sync";

const path = "/account/marketplaces/";
function result(code: string): never { redirect(`${path}?result=${code}`); }
async function authorized() { await requirePermission("products.write"); await requirePermission("products.publish"); return requirePermission("settings.write"); }
const activeWhere = { status: { in: ["QUEUED", "RUNNING"] } };
function providerFrom(form: FormData) {
  const parsed = z.enum(providers).safeParse(form.get("provider"));
  if (!parsed.success) result("invalid");
  return parsed.data;
}

export async function saveMarketplaceConnection(form: FormData) {
  const user = await authorized();
  if (!rateLimit(`marketplace-config:${user.id}`, 2, 60_000).allowed) result("rate");
  const provider = providerFrom(form);
  let current;
  try { current = await getConnection(provider); } catch { result("connection"); }
  const secret = String(form.get("secret") ?? "").trim().replace(/^Bearer\s+/i, "") || current?.secret || "";
  const clientId = String(form.get("clientId") ?? "").trim();
  if (!secret || secret.length > 10_000 || /[^\x21-\x7e]/.test(secret) || (provider === "ozon" && !/^\d{1,100}$/.test(clientId))) result("invalid");
  const config = { accountId: "", name: "", secret, clientId: provider === "ozon" ? clientId : "", checkedAt: new Date().toISOString() };
  let checked;
  try { checked = await checkConnection(provider, config); } catch { result("connection"); }
  const saved = await prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: activeWhere })) return "busy";
    // An old tab cannot replace a newer connection, and a merchant cannot be
    // silently changed under an existing set of product mappings.
    if (JSON.stringify(await getConnection(provider, tx)) !== JSON.stringify(current)) return "busy";
    if (await tx.marketplaceListing.count({ where: { provider, accountId: { not: checked.accountId } } })) return "account";
    const value = { ...config, ...checked, secret: encryptSecret(secret, connectionKey(provider)) };
    await tx.siteSetting.upsert({ where: { key: connectionKey(provider) }, create: { key: connectionKey(provider), group: "integrations", value }, update: { value, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.connection.update", entityType: "SiteSetting", after: { provider, accountId: checked.accountId } } });
    return "saved";
  });
  revalidatePath(path); result(saved);
}

export async function saveMarketplacePolicy(form: FormData) {
  const user = await authorized();
  const parsed = policySchema.safeParse({ primary: form.get("primary"), categoryId: form.get("categoryId") ?? "" });
  if (!parsed.success) result("invalid");
  const code = await prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: activeWhere })) return "busy";
    if (parsed.data.categoryId && !await tx.category.findUnique({ where: { id: parsed.data.categoryId } })) return "invalid";
    await tx.siteSetting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, group: "integrations", value: parsed.data }, update: { value: parsed.data, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.policy.update", entityType: "SiteSetting", after: parsed.data } });
    return "saved";
  });
  revalidatePath(path); result(code);
}

export async function startMarketplaceSync(form: FormData) {
  const user = await authorized();
  if (!rateLimit(`marketplace-start:${user.id}`, 5, 60_000).allowed) result("rate");
  const provider = providerFrom(form);
  const code = await prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: activeWhere })) return "busy";
    const connection = await getConnection(provider, tx);
    if (!connection) return "connection";
    const run = await tx.marketplaceSyncRun.create({ data: { provider, accountId: connection.accountId, actorId: user.id } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.sync.start", entityType: "MarketplaceSyncRun", entityId: run.id, after: { provider } } });
    return "queued";
  });
  revalidatePath(path); result(code);
}

export async function cancelMarketplaceSync(form: FormData) {
  const user = await authorized();
  const id = z.string().min(1).max(100).parse(form.get("id"));
  await prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    const changed = await tx.marketplaceSyncRun.updateMany({ where: { id, ...activeWhere }, data: { status: "CANCELED", finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
    if (changed.count) await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.sync.cancel", entityType: "MarketplaceSyncRun", entityId: id } });
  });
  updateTag("catalog"); revalidatePath(path); result("canceled");
}

export async function mapMarketplaceListing(form: FormData) {
  const user = await authorized();
  const parsed = z.object({ id: z.string().min(1).max(100), productId: z.string().min(1).max(100) }).safeParse({ id: form.get("id"), productId: form.get("productId") });
  if (!parsed.success) result("invalid");
  let code = "mapped";
  try {
    code = await prisma.$transaction(async (tx) => {
      await marketplaceLock(tx);
      if (await tx.marketplaceSyncRun.count({ where: activeWhere })) return "busy";
      await mapListing(tx, parsed.data.id, parsed.data.productId);
      await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.listing.map", entityType: "MarketplaceListing", entityId: parsed.data.id, after: { productId: parsed.data.productId } } });
      return "mapped";
    }, { timeout: 30_000 });
  } catch { code = "mapping"; }
  updateTag("catalog"); revalidatePath(path); result(code);
}

export async function setMarketplaceProductMode(form: FormData) {
  const user = await authorized();
  const parsed = z.object({ id: z.string().min(1).max(100), mode: z.enum(["SITE", "AUTO"]) }).safeParse({ id: form.get("id"), mode: form.get("mode") });
  if (!parsed.success) result("invalid");
  const code = await prisma.$transaction(async (tx) => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: activeWhere })) return "busy";
    if (!await tx.marketplaceListing.count({ where: { productId: parsed.data.id } })) return "invalid";
    await tx.product.update({ where: { id: parsed.data.id }, data: { marketplaceMode: parsed.data.mode } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "marketplace.product.mode", entityType: "Product", entityId: parsed.data.id, after: { mode: parsed.data.mode } } });
    return "saved";
  });
  revalidatePath(path); result(code);
}
