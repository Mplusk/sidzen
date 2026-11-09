"use server";

import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { deleteProduct } from "@/lib/product-delete";

export async function deleteProductAction(form: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  let result: Awaited<ReturnType<typeof deleteProduct>>;
  try {
    result = await deleteProduct({ id: String(form.get("id") ?? ""), confirmation: String(form.get("confirmation") ?? "") }, { id: user.id, canPublish: user.roles.includes("superadmin") || user.permissions.has(PERMISSIONS.productsPublish) });
  } catch (error) {
    const code = error instanceof Error && ["confirmation", "busy", "missing", "permission", "reserved"].includes(error.message) ? error.message : "failed";
    redirect(`/admin/products/?deleteError=${code}`);
  }
  updateTag("catalog");
  revalidatePath("/catalog", "layout");
  for (const category of result.categories) revalidatePath(`/catalog/${category}/${result.slug}/`);
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  revalidatePath("/cart/");
  redirect("/admin/products/?deleted=1");
}
