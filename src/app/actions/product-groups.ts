"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { marketplaceLock } from "@/lib/marketplaces/sync";

export async function saveProductGroup(form: FormData) {
  const user = await requirePermission("products.write");
  await requirePermission("products.publish");
  const parsed = z.object({
    productId: z.string().min(1).max(100), groupId: z.string().max(100),
    newName: z.string().trim().max(180), label: z.string().trim().max(180),
    mode: z.enum(["AUTO", "MANUAL"]),
  }).safeParse(Object.fromEntries(["productId", "groupId", "newName", "label", "mode"].map(key => [key, form.get(key) ?? ""])));
  if (!parsed.success) redirect("/admin/products/");
  const data = parsed.data, path = `/admin/products/${data.productId}/`;
  if (!rateLimit(`product-group:${user.id}`, 30, 60_000).allowed) redirect(`${path}?groupError=rate`);
  try {
    await prisma.$transaction(async tx => {
      await marketplaceLock(tx);
      if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new Error("busy");
      const product = await tx.product.findUniqueOrThrow({ where: { id: data.productId } });
      let groupId: string | null = data.groupId || null;
      if (data.mode === "AUTO") {
        // Opt in for the next sync; don't overwrite the current selection now.
        groupId = product.groupId;
      } else if (data.newName) {
        groupId = (await tx.productGroup.create({ data: { name: data.newName } })).id;
      } else if (groupId && !await tx.productGroup.findUnique({ where: { id: groupId } })) throw new Error("group");
      await tx.product.update({ where: { id: product.id }, data: {
        groupId, groupingMode: data.mode,
        ...(data.mode === "MANUAL" ? { groupLabel: groupId ? data.label || product.sku : null } : {}),
      } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "product.group.update", entityType: "Product", entityId: product.id, before: { groupId: product.groupId, groupLabel: product.groupLabel, mode: product.groupingMode }, after: { groupId, label: data.label, mode: data.mode } } });
    });
  } catch { redirect(`${path}?groupError=save`); }
  updateTag("catalog"); revalidatePath("/catalog/", "layout"); revalidatePath("/admin/products/", "layout");
  redirect(`${path}?saved=1`);
}
