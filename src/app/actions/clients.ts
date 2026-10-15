"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { setClientArchived } from "@/lib/clients";
import { eraseClientData, ErasureError } from "@/lib/privacy-erasure";

export async function changeClientArchive(form: FormData) {
  const user = await requirePermission(PERMISSIONS.customersWrite);
  // Write permission is not sufficient to disclose the directory itself.
  await requirePermission(PERMISSIONS.customersRead);
  const key = form.get("clientKey"), operation = form.get("operation");
  if (typeof key !== "string" || key.length > 1024 || !/^(account:|order:).+/.test(key) || (operation !== "archive" && operation !== "restore") || form.get("confirmation") !== operation) redirect("/account/clients/?result=confirmation");
  if (!rateLimit(`client-change:${user.id}`, 30, 60000).allowed) redirect("/account/clients/?result=rate");
  const found = await setClientArchived(key, operation === "archive", user.id);
  revalidatePath("/account/clients/");
  redirect(`/account/clients/?${operation === "restore" ? "view=deleted&" : ""}result=${found ? operation === "archive" ? "deleted" : "restored" : "missing"}`);
}

export async function eraseClientPersonalData(form: FormData) {
  const actor = await requirePermission(PERMISSIONS.customersWrite);
  await requirePermission(PERMISSIONS.customersRead);
  await requirePermission(PERMISSIONS.usersWrite);
  await requirePermission(PERMISSIONS.ordersWrite);
  const key = form.get("clientKey");
  if (typeof key !== "string" || !/^(account:|order:)[A-Za-z0-9_-]{1,100}$/.test(key) || form.get("confirmation") !== "erase" || form.get("phrase") !== "УДАЛИТЬ" || form.get("verified") !== "on") redirect("/account/clients/?result=confirmation");
  if (!rateLimit(`client-erasure:${actor.id}`, 5, 60000).allowed) redirect("/account/clients/?result=rate");
  let result = "erased";
  try {
    const plan = await eraseClientData(key, actor.id);
    result = plan.retainedIds.length ? "erased-retained" : "erased";
  } catch (error) {
    result = error instanceof ErasureError ? `erasure-${error.code}` : "erasure-failed";
  }
  revalidatePath("/account", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/catalog", "layout");
  redirect(`/account/clients/?result=${result}`);
}
