import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getFivePostConfig } from "@/lib/delivery/fivepost-config";
import { FivePostClient } from "@/lib/delivery/fivepost-client";

export async function GET(request: Request) {
  const user = await requirePermission("orders.write");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!rateLimit(`fivepost-label:${user.id}`, 20, 60000).allowed) return new Response("Повторите через минуту.", { status: 429, headers });
  const id = new URL(request.url).searchParams.get("jobId");
  if (!id || id.length > 80) return new Response(null, { status: 404, headers });
  const job = await prisma.fivePostDeliveryJob.findUnique({ where: { id }, select: { warehouseId: true, remoteId: true, status: true } });
  if (!job?.remoteId || job.status === "CANCELED") return new Response("Этикетка недоступна.", { status: 404, headers });
  try {
    const config = await getFivePostConfig();
    if (config.environment !== "production" || !config.apiKey || job.warehouseId !== config.warehouseId) throw new Error("settings");
    const pdf = await new FivePostClient(config).label(job.remoteId);
    return new Response(pdf, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="5post-label.pdf"' } });
  } catch { return new Response("Этикетка ещё не готова. Проверьте, что для договора включены PDF-этикетки 5Post.", { status: 409, headers }); }
}
