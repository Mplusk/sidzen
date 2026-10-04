import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const user = await requirePermission("orders.write");
  if (!rateLimit(`ozon-label:${user.id}`, 30, 60000).allowed) return new Response("Повторите позже", { status: 429 });
  const params = new URL(request.url).searchParams;
  const job = await prisma.ozonDeliveryJob.findUnique({ where: { id: params.get("jobId") || "" } });
  const parsed = z.object({ postings: z.array(z.object({ posting_number: z.string() })) }).safeParse(job?.response);
  const posting = params.get("posting");
  if (!job || !parsed.success || !parsed.data.postings.some(value => value.posting_number === posting)) return new Response("Отправление не найдено", { status: 404 });
  try {
    const config = await getOzonDeliveryConfig(); if (config.clientId !== job.clientId) throw new Error("client");
    const response = await new OzonDeliveryClient(config).call("/v1/posting/label", { posting_number: posting });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 10000000 || Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") throw new Error("pdf");
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=ozon-label.pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Этикетка ещё не готова. Обновите статусы после подтверждения отгрузки или проверьте кабинет Ozon.", { status: 409, headers: { "Cache-Control": "no-store" } }); }
}
