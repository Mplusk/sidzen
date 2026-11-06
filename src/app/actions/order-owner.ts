"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { linkOrderOwner } from "@/lib/order-owner";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export async function linkOrderOwnerAction(formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.usersWrite);
  if (!actor.roles.includes("superadmin") && !actor.permissions.has(PERMISSIONS.ordersWrite)) redirect("/account/?error=forbidden");
  const input = z.object({ orderId: id, orderNumber: z.string().min(1).max(100), targetUserId: id, expectedOwnerId: z.union([id, z.literal("")]), confirmation: z.string().min(1).max(100), attested: z.literal("on") }).safeParse({ orderId: formData.get("orderId"), orderNumber: formData.get("orderNumber"), targetUserId: formData.get("targetUserId"), expectedOwnerId: formData.get("expectedOwnerId"), confirmation: formData.get("confirmation"), attested: formData.get("attested") });
  if (!input.success || input.data.confirmation !== input.data.orderNumber) redirect("/admin/orders/?error=confirmation");
  const result = await linkOrderOwner(prisma, { actorId: actor.id, orderId: input.data.orderId, orderNumber: input.data.orderNumber, targetUserId: input.data.targetUserId, expectedOwnerId: input.data.expectedOwnerId || null });
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(`/admin/orders/${encodeURIComponent(input.data.orderNumber)}/?owner=${encodeURIComponent(result)}`);
}
