"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { releaseReviewedStock } from "@/lib/stock-reconciliation";
import { confirmLegacyStock } from "@/lib/legacy-stock-reconciliation";

export async function releaseReviewedStockAction(form: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const parsed = z.object({ orderId: z.string().min(1).max(100), number: z.string().min(1).max(100), confirmation: z.string().min(1).max(100), reason: z.string().trim().min(10).max(500), physical: z.literal("on"), obligations: z.literal("on") }).safeParse(Object.fromEntries(["orderId", "number", "confirmation", "reason", "physical", "obligations"].map(key => [key, form.get(key)])));
  const number = String(form.get("number") ?? "").slice(0, 100);
  const path = `/admin/orders/${encodeURIComponent(number)}/`;
  if (!parsed.success || parsed.data.number !== parsed.data.confirmation) redirect(`${path}?stock=confirmation`);
  try { await releaseReviewedStock({ ...parsed.data, actorId: user.id }); }
  catch (error) {
    const code = error instanceof Error && ["missing", "order-active", "payment-active", "delivery-active", "no-reservation"].includes(error.message) ? error.message : "error";
    redirect(`${path}?stock=${code}`);
  }
  updateTag("catalog");
  revalidatePath("/admin", "layout");
  revalidatePath("/catalog", "layout");
  redirect(`${path}?stock=released`);
}

export async function confirmLegacyStockAction(form: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const path = `/admin/orders/${encodeURIComponent(String(form.get("number") ?? "").slice(0, 100))}/`;
  const parsed = z.object({ orderId: z.string().min(1).max(100), number: z.string().min(1).max(100), confirmation: z.string().min(1).max(100), reason: z.string().trim().min(10).max(500), reviewed: z.literal("on"), products: z.string().max(100_000), reviewSnapshot: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(Object.fromEntries(["orderId", "number", "confirmation", "reason", "reviewed", "products", "reviewSnapshot"].map(key => [key, form.get(key)])));
  if (!parsed.success || parsed.data.number !== parsed.data.confirmation) redirect(`${path}?legacyStock=error`);
  try {
    const products = z.array(z.object({ id: z.string().min(1).max(100), stock: z.number().int().nonnegative(), reservedStock: z.number().int().nonnegative() })).max(1000).parse(JSON.parse(parsed.data.products));
    await confirmLegacyStock({ ...parsed.data, products, actorId: user.id });
  } catch { redirect(`${path}?legacyStock=error`); }
  updateTag("catalog");
  revalidatePath("/admin", "layout");
  revalidatePath("/catalog", "layout");
  redirect(`${path}?legacyStock=saved`);
}
