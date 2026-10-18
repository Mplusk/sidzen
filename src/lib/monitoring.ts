import { prisma } from "@/lib/prisma";
import { MONITORING_DAYS, MONITORING_LOCK, isStaticMonitoringPath, monitoringCutoff, monitoringDay, publicMonitoringPath } from "@/lib/monitoring-policy";

export async function recordPageView(input: string, now = new Date()) {
  const path = publicMonitoringPath(input);
  if (!path) return;
  let productId: string | null = null;
  if (!isStaticMonitoringPath(path)) {
    const [, , categorySlug, productSlug] = path.split("/");
    // Resolve untrusted slugs to real public entries, not arbitrary URLs/text.
    if (productSlug) {
      const product = await prisma.product.findFirst({ where: { slug: productSlug, status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { slug: categorySlug, visible: true } } } }, select: { id: true } });
      if (!product) return;
      productId = product.id;
    } else if (!await prisma.category.findFirst({ where: { slug: categorySlug, visible: true }, select: { id: true } })) return;
  }
  const day = monitoringDay(now);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
    await tx.monitoringCounter.upsert({ where: { day_path: { day, path } }, create: { day, path, productId, views: 1n }, update: { views: { increment: 1n } } });
  }, { maxWait: 1000, timeout: 4000 });
}

export async function pruneMonitoring(now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MONITORING_LOCK})`;
    return (await tx.monitoringCounter.deleteMany({ where: { day: { lt: monitoringCutoff(MONITORING_DAYS, now) } } })).count;
  });
}
