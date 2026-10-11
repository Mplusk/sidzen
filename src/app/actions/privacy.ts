"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rfStorageReady } from "@/lib/privacy";

export async function answerPersonalDataRequest(form: FormData) {
  const actor = await requirePermission("users.write");
  if (!rfStorageReady()) redirect("/admin/privacy/?error=localization");
  const parsed = z.object({ id: z.string().min(1).max(100), status: z.enum(["IN_PROGRESS", "RESOLVED"]), response: z.string().trim().min(5).max(2000) }).safeParse({ id: form.get("id"), status: form.get("status"), response: form.get("response") });
  if (!parsed.success) redirect("/admin/privacy/?error=invalid");
  await prisma.$transaction(async tx => {
    await tx.privacyRequest.update({ where: { id: parsed.data.id }, data: { status: parsed.data.status, response: parsed.data.response } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "privacy.request.respond", entityType: "PrivacyRequest", entityId: parsed.data.id, after: { status: parsed.data.status } } });
  });
  revalidatePath("/admin/privacy/");
}
