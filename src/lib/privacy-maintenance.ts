import { prisma } from "@/lib/prisma";
export async function pruneTransientPersonalData(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.cart.deleteMany({ where: { userId: null, updatedAt: { lt: cutoff }, items: { none: { updatedAt: { gte: cutoff } } } } });
  await prisma.privacyConsent.deleteMany({ where: { purpose: "ozon", orderId: null, createdAt: { lt: new Date(now.getTime() - 90 * 86400000) } } });
}
