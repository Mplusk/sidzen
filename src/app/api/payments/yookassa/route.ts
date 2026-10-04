import { refreshPayment } from "@/lib/payments";
import { z } from "zod";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 32_768) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const input = z.object({ type: z.literal("notification"), event: z.enum(["payment.succeeded", "payment.canceled", "payment.waiting_for_capture"]), object: z.object({ id: z.string().uuid() }) }).safeParse(body);
  if (!input.success) return new Response(null, { status: 400 });
  try {
    // Ignore all amounts/statuses from the webhook body; authenticate a fresh GET
    // to the provider and validate it against the order before changing anything.
    await refreshPayment(input.data.object.id);
    return Response.json({ ok: true });
  } catch {
    console.error("Payment verification failed");
    return new Response(null, { status: 503 });
  }
}
