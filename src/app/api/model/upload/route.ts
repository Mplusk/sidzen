import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { analyzeModel } from "@/lib/model-analysis";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { hasTrustedOrigin } from "@/lib/request-security";
import { assertModelFile, storeModelFile } from "@/lib/storage";

export const runtime = "nodejs";

const GUEST_FILE_COOKIE = "3dp_file_owner";

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
    const headerStore = await headers();
    const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`model-upload:${ip}`, 12, 60 * 60 * 1000).allowed) return NextResponse.json({ error: "Слишком много загрузок. Повторите позже." }, { status: 429 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Выберите файл модели" }, { status: 400 });
    const maximumBytes = (Number(process.env.MAX_UPLOAD_MB) || 100) * 1024 * 1024;
    if (file.size > maximumBytes) return NextResponse.json({ error: `Максимальный размер — ${Math.floor(maximumBytes / 1024 / 1024)} МБ` }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = assertModelFile(buffer, file.name);
    const analysis = analyzeModel(buffer, extension);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const user = await getCurrentUser();
    const cookieStore = await cookies();
    let guestKey = user ? undefined : cookieStore.get(GUEST_FILE_COOKIE)?.value;
    if (!user && !guestKey) {
      guestKey = randomBytes(24).toString("base64url");
      cookieStore.set(GUEST_FILE_COOKIE, guestKey, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    }
    const existing = await prisma.customerModelFile.findFirst({ where: user ? { ownerId: user.id, sha256 } : { guestKey, sha256 } });
    if (existing) return NextResponse.json({ file: serialize(existing), duplicate: true });
    const storedName = await storeModelFile(buffer, extension);
    const record = await prisma.customerModelFile.create({
      data: {
        ownerId: user?.id,
        guestKey,
        originalName: file.name.slice(0, 240),
        storedName,
        extension,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sha256,
        widthMm: analysis.widthMm,
        heightMm: analysis.heightMm,
        depthMm: analysis.depthMm,
        volumeCm3: analysis.volumeCm3,
        watertight: analysis.watertight,
        status: analysis.format === "manual" || !analysis.watertight ? "NEEDS_REVIEW" : "ANALYZED",
        analysisNote: analysis.note,
      },
    });
    return NextResponse.json({ file: serialize(record) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать файл";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function serialize(file: { id: string; originalName: string; extension: string; sizeBytes: bigint; widthMm: unknown; heightMm: unknown; depthMm: unknown; volumeCm3: unknown; watertight: boolean | null; status: string; analysisNote: string | null }) {
  return { ...file, sizeBytes: Number(file.sizeBytes), widthMm: numberOrNull(file.widthMm), heightMm: numberOrNull(file.heightMm), depthMm: numberOrNull(file.depthMm), volumeCm3: numberOrNull(file.volumeCm3) };
}

function numberOrNull(value: unknown) {
  return value == null ? null : Number(value);
}
