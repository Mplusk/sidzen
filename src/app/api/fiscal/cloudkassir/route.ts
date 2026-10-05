import { acceptCloudNotification, readCloudBody } from "@/lib/cloudkassir/webhook";
import { ZodError } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 415 });
  try {
    const raw = await readCloudBody(request);
    // Content-HMAC signs the original URL-encoded bytes. Never reserialize or
    // use the decoded X-Content-HMAC with the encoded body.
    await acceptCloudNotification(raw, request.headers.get("content-hmac"));
    return Response.json({ code: 0 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid";
    return new Response(null, { status: message === "signature" ? 401 : message === "size" ? 413 : message === "binding" || message === "duplicate" || error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
