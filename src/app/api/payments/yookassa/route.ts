import { refreshPayment } from "@/lib/payments";
import { z } from "zod";
import { readWebhookBody } from "@/lib/tochka/webhook";

export async function POST(request: Request) {
  let body: unknown;
  try { body = JSON.parse(await readWebhookBody(request)); } catch (error) { return new Response(null, { status: error instanceof Error && error.message === "webhook-too-large" ? 413 : 400 }); }
  const input = z.discriminatedUnion("event", [
    z.object({ type: z.literal("notification"), event: z.enum(["payment.succeeded", "payment.canceled", "payment.waiting_for_capture"]), object: z.object({ id: z.string().uuid() }) }),
    z.object({ type: z.literal("notification"), event: z.literal("refund.succeeded"), object: z.object({ id: z.string().uuid(), payment_id: z.string().uuid() }) }),
  ]).safeParse(body);
  if (!input.success) return new Response(null, { status: 400 });
  try {
    // Ignore all amounts/statuses from the webhook body; authenticate a fresh GET
    // to the provider and validate it against the order before changing anything.
    await refreshPayment(input.data.event === "refund.succeeded" ? input.data.object.payment_id : input.data.object.id);
    return Response.json({ ok: true });
  } catch {
    console.error("Payment verification failed");
    return new Response(null, { status: 503 });
  }
}
