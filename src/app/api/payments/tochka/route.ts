import { prisma } from "@/lib/prisma";
import { applyTochkaPayment } from "@/lib/payments";
import { getTochkaConfig } from "@/lib/tochka/config";
import { getTochkaOperation } from "@/lib/tochka/client";
import { readWebhookBody, verifyTochkaWebhook } from "@/lib/tochka/webhook";

export async function POST(request: Request) {
  let jwt: string;
  try { jwt = await readWebhookBody(request); }
  catch (error) { return new Response(null, { status: error instanceof Error && error.message === "webhook-too-large" ? 413 : 400 }); }
  let claims;
  try { claims = await verifyTochkaWebhook(jwt); }
  catch (error) { return new Response(null, { status: error instanceof Error && error.message === "webhook-key-unavailable" ? 503 : 401 }); }
  // Signed registration/test events and payments belonging to other services are acknowledged.
  if (claims.webhookType !== "acquiringInternetPayment" || !claims.operationId) return Response.json({ ok: true });
  try {
    const payment = await prisma.payment.findFirst({ where: { provider: "tochka", OR: [{ externalId: claims.operationId }, ...(claims.paymentLinkId ? [{ id: claims.paymentLinkId }] : [])] } });
    if (!payment) return Response.json({ ok: true });
    const config = await getTochkaConfig();
    if (claims.customerCode !== config.customerCode || claims.merchantId !== config.merchantId) return new Response(null, { status: 400 });
    // Even a correctly signed event cannot substitute for a fresh bank GET and
    // comparison of amount, company, merchant, link ID and local order total.
    await applyTochkaPayment(payment.id, await getTochkaOperation(config, claims.operationId));
    return Response.json({ ok: true });
  } catch { return new Response(null, { status: 503 }); }
}
