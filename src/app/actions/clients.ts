"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { setClientArchived } from "@/lib/clients";

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
