"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { setUserArchived } from "@/lib/user-archive";
import { eraseUserData, ErasureError } from "@/lib/privacy-erasure";

export async function manageUserAction(form: FormData) {
  const actor = await requirePermission(PERMISSIONS.usersWrite);
  const userId = form.get("userId"), operation = form.get("operation");
  const archivedView = form.get("view") === "archived";
  const back = archivedView ? "/admin/users/?view=archived&" : "/admin/users/?";
  if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(userId) || !["archive", "restore", "erase"].includes(String(operation)) || form.get("confirmation") !== operation) redirect(`${back}result=confirmation`);
  if (!rateLimit(`user-management:${actor.id}`, operation === "erase" ? 5 : 30, 60000).allowed) redirect(`${back}result=rate`);
  let result: string;
  if (operation === "erase") {
    await requirePermission(PERMISSIONS.customersRead);
    await requirePermission(PERMISSIONS.customersWrite);
    await requirePermission(PERMISSIONS.ordersWrite);
    if (form.get("verified") !== "on" || form.get("phrase") !== "УДАЛИТЬ") redirect(`${back}result=confirmation`);
    try {
      const plan = await eraseUserData(userId, actor.id);
      result = plan.retainedIds.length ? "erased-retained" : "erased";
    } catch (error) {
      result = error instanceof ErasureError ? `erasure-${error.code}` : "erasure-failed";
    }
    revalidatePath("/account", "layout");
    revalidatePath("/catalog", "layout");
  } else {
    result = await setUserArchived(prisma, { actorId: actor.id, userId, archive: operation === "archive" });
  }
  revalidatePath("/admin", "layout");
  redirect(`${back}result=${result}`);
}

