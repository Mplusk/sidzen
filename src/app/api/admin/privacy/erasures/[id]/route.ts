import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const user = await getCurrentUser();
  if (!user || (!user.roles.includes("superadmin") && !user.permissions.has("users.write"))) return new Response(null, { status: user ? 403 : 401, headers });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404, headers });
  const record = await prisma.privacyErasure.findUnique({ where: { id: id.data } });
  if (!record) return new Response(null, { status: 404, headers });
  return Response.json({ note: "Техническая выгрузка, не подписанный акт уничтожения. Обязательные документы и сроки указаны отдельно.", record }, { headers: { ...headers, "Content-Disposition": `attachment; filename="privacy-erasure-${id.data}.json"` } });
}
