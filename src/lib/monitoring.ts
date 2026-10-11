import { prisma } from "@/lib/prisma";
import { MONITORING_DAYS, MONITORING_LOCK, monitoringId, publicMonitoringPath, safeSearch, monitoringSource, monitoringAgent, type readMonitoringConsent } from "@/lib/monitoring-policy";
import { monitoringCountry } from "@/lib/monitoring-country";
import { z } from "zod";

export const monitoringEvent = z.object({
  type: z.enum(["view", "heartbeat"]), visit: z.uuid(), page: z.uuid(),
  path: z.string().max(240).optional(), search: z.string().max(120).optional(),
  referrer: z.string().max(1000).optional(), campaign: z.string().max(80).optional(),
  seconds: z.number().int().min(0).max(86400).optional(),
}).strict();

export async function recordMonitoring(consent: NonNullable<ReturnType<typeof readMonitoringConsent>>, event: z.infer<typeof monitoringEvent>, context: { ip: string | null; agent: string; userId?: string }) {
  const agent = monitoringAgent(context.agent);
  if (agent.bot) return;
  const now = new Date(), cutoff = new Date(now.getTime() - MONITORING_DAYS * 86400000);
  const visitId = monitoringId(consent.visitorHash, event.visit), pageId = monitoringId(visitId, event.page);
  const path = publicMonitoringPath(event.path ?? "");
  if (event.type === "view" && !path) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
    const receipt = await tx.monitoringConsent.findUnique({ where: { visitorHash: consent.visitorHash } });
    if (!receipt || receipt.expiresAt <= now) throw new Error("Statistics consent expired");
    if (event.type === "view") {
      const existing = await tx.monitoringVisit.findUnique({ where: { id: visitId }, select: { createdAt: true } });
      if (existing && existing.createdAt < cutoff) return;
      if (!existing && await tx.monitoringVisit.count() >= 20000) return;
      if (await tx.monitoringPage.count() >= 100000) return;
      // Per-visit cap plus hourly global pruning bounds disk use.
      if (await tx.monitoringPage.count({ where: { visitId } }) >= 200) return;
      await tx.monitoringVisit.upsert({ where: { id: visitId }, create: {
        id: visitId, visitorHash: consent.visitorHash, userId: context.userId,
        consentAt: consent.at, consentVersion: consent.version,
        ip: context.ip, country: monitoringCountry(context.ip), browser: agent.browser, device: agent.device,
        ...monitoringSource(event.referrer, event.campaign),
      }, update: { lastSeenAt: now, ...(context.userId ? { userId: context.userId } : {}) } });
      await tx.monitoringPage.upsert({ where: { id: pageId }, create: { id: pageId, visitId, path: path!, search: safeSearch(event.search) }, update: {} });
    } else {
      const page = await tx.monitoringPage.findFirst({ where: { id: pageId, visitId, visit: { visitorHash: consent.visitorHash, createdAt: { gte: cutoff } } } });
      if (!page) return; // An old heartbeat cannot resurrect manually cleared data.
      const elapsed = Math.max(0, Math.floor((now.getTime() - page.lastSeenAt.getTime()) / 1000));
      const requested = Math.max(page.activeSeconds, event.seconds ?? 0);
      const seconds = Math.min(requested, page.activeSeconds + elapsed + 1, Math.floor((now.getTime() - page.createdAt.getTime()) / 1000) + 1);
      await tx.monitoringPage.update({ where: { id: pageId }, data: { activeSeconds: seconds, lastSeenAt: now } });
      await tx.monitoringVisit.update({ where: { id: visitId }, data: { lastSeenAt: now } });
    }
  }, { maxWait: 1000, timeout: 4000 });
}

export async function pruneMonitoring(now = new Date()) {
  const cutoff = new Date(now.getTime() - MONITORING_DAYS * 86400000);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
    const expired = await tx.monitoringVisit.deleteMany({ where: { OR: [{ createdAt: { lt: cutoff } }, { consentAt: { lt: cutoff } }] } });
    await tx.monitoringConsent.deleteMany({ where: { expiresAt: { lte: now } } });
    const overflow = await tx.monitoringVisit.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 20000, select: { id: true } });
    if (overflow.length) await tx.monitoringVisit.deleteMany({ where: { id: { in: overflow.map(visit => visit.id) } } });
    return expired.count + overflow.length;
  }, { timeout: 10000 });
}
