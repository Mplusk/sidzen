import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { rateLimit } from "@/lib/rate-limit";
import { MONITORING_COOKIE, MONITORING_DAYS, MONITORING_LOCK, monitoringConsent, monitoringOriginAllowed, readMonitoringConsent, trustedVisitorIp, monitoringId } from "@/lib/monitoring-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const empty = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  if (!monitoringOriginAllowed(request)) return empty(403);
  // A fixed query flag avoids reading arbitrary bodies at the consent endpoint.
  const choice = new URL(request.url).searchParams.get("choice");
  if (choice !== "allow" && choice !== "deny") return empty(400);
  const jar = await cookies(), old = readMonitoringConsent(jar.get(MONITORING_COOKIE)?.value);
  try {
    if (choice === "deny") {
      if (old) await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
        await tx.monitoringVisit.deleteMany({ where: { visitorHash: old.visitorHash } });
        await tx.monitoringConsent.deleteMany({ where: { visitorHash: old.visitorHash } });
      });
      jar.set(MONITORING_COOKIE, "", { maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      return empty();
    }
    if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return empty(403);
    const ip = trustedVisitorIp(request.headers);
    if (!rateLimit("monitor-consent:" + monitoringId("rate", ip ?? "unknown"), 20, 60000).allowed) return empty(429);
    if (!(await operatorReady())) return empty(503);
    const token = monitoringConsent(), receipt = readMonitoringConsent(token)!;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
      if (await tx.monitoringConsent.count() >= 30000) throw new Error("Statistics capacity reached");
      if (old) {
        await tx.monitoringVisit.deleteMany({ where: { visitorHash: old.visitorHash } });
        await tx.monitoringConsent.deleteMany({ where: { visitorHash: old.visitorHash } });
      }
      await tx.monitoringConsent.create({ data: { visitorHash: receipt.visitorHash, createdAt: receipt.at, version: receipt.version, expiresAt: new Date(receipt.at.getTime() + MONITORING_DAYS * 86400000) } });
    });
    jar.set(MONITORING_COOKIE, token, { maxAge: MONITORING_DAYS * 86400, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return empty();
  } catch { return empty(503); }
}
