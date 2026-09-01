import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readModelFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = await prisma.customerModelFile.findUnique({ where: { id } });
  if (!model) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const user = await getCurrentUser();
  const guestKey = (await cookies()).get("3dp_file_owner")?.value;
  const staff = Boolean(user?.permissions.has("files.read") || user?.roles.includes("superadmin"));
  const allowed = (model.ownerId && user?.id === model.ownerId) || (!model.ownerId && guestKey && guestKey === model.guestKey) || staff;
  if (!allowed) return NextResponse.json({ error: "Нет доступа" }, { status: user ? 403 : 401 });
  const file = await readModelFile(model.storedName);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": model.mimeType,
      "Content-Length": String(file.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(model.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
