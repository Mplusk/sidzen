"use server";

import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { MONITORING_LOCK } from "@/lib/monitoring-policy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function clearMonitoring(form: FormData) {
  const user = await requirePermission("monitoring.clear");
  if (form.get("confirmation") !== "clear-all-monitoring") redirect("/account/monitoring/?result=confirmation");
  if (!rateLimit(`monitoring-clear:${user.id}`, 3, 60000).allowed) redirect("/account/monitoring/?result=rate");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
    const deleted = await tx.monitoringCounter.deleteMany({});
    await tx.auditLog.create({ data: { actorId: user.id, action: "monitoring.clear", entityType: "MonitoringCounter", after: { deletedCount: deleted.count } } });
  });
  revalidatePath("/account/monitoring/");
  redirect("/account/monitoring/?result=cleared");
}
