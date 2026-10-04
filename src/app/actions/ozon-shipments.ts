"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { processOzonJob, refreshOzonJob } from "@/lib/delivery/ozon-worker";

export async function manageOzonShipment(form: FormData) {
  const user = await requirePermission("orders.write");
  const jobId = String(form.get("jobId") ?? ""); const intent = String(form.get("intent") ?? "");
  const job = await prisma.ozonDeliveryJob.findUnique({ where: { id: jobId }, include: { shipment: { include: { order: true } } } });
  if (!job) redirect("/admin/orders/");
  const path = `/admin/orders/${job.shipment.order.number}/`;
  if (!rateLimit(`ozon-shipment:${user.id}`, 20, 60000).allowed) redirect(`${path}?delivery=error`);
  let success = false;
  try {
    if (intent === "create") success = await processOzonJob(job.id);
    else if (intent === "status") success = await refreshOzonJob(job.id);
    else if (intent === "cancel-pending") {
      if (form.get("confirmation") !== job.shipment.order.number) throw new Error("confirmation");
      success = !!(await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, status: "PENDING", attempts: 0, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { status: "CANCELED" } })).count;
    }
    else if (intent === "approve" || intent === "cancel") {
      if (intent === "cancel" && form.get("confirmation") !== job.shipment.order.number) throw new Error("confirmation");
      const config = await getOzonDeliveryConfig();
      if (config.clientId !== job.clientId || (job.status !== "CREATED" && !(intent === "cancel" && job.status === "REVIEW"))) throw new Error("job");
      const response = z.object({ postings: z.array(z.object({ posting_number: z.string().min(1) })).min(1) }).parse(job.response);
      const api = new OzonDeliveryClient(config);
      for (const posting of response.postings) await api.call(intent === "approve" ? "/v1/posting/approve" : "/v1/posting/cancel", { posting_number: posting.posting_number });
      await refreshOzonJob(job.id); success = true;
    }
    if (success) await prisma.auditLog.create({ data: { actorId: user.id, action: `integration.ozon-delivery.${intent}`, entityType: "Shipment", entityId: job.shipmentId } });
  } catch { success = false; }
  revalidatePath(path); revalidatePath("/account/orders/", "layout");
  redirect(`${path}?delivery=${success ? "updated" : "error"}`);
}
