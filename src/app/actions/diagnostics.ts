"use server";

import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { LOG_LOCK } from "@/lib/diagnostics";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function clearDiagnosticLogs(form: FormData) {
  const user = await requirePermission("settings.write");
  if (form.get("confirmation") !== "delete-all-diagnostic-logs") redirect("/account/logs/?result=confirmation");
  if (!rateLimit(`logs-clear:${user.id}`, 3, 60000).allowed) redirect("/account/logs/?result=rate");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOG_LOCK})`;
    const deleted = await tx.diagnosticLog.deleteMany({});
    // Immutable audit is separate from the deletable diagnostic journal.
    await tx.auditLog.create({ data: { actorId: user.id, action: "diagnostics.clear", entityType: "DiagnosticLog", after: { deletedCount: deleted.count } } });
  });
  revalidatePath("/account/logs/");
  redirect("/account/logs/?result=cleared");
}
