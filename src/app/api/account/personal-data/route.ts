import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow", "Vary": "Cookie" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Требуется вход" }, { status: 401, headers });
  if (!rateLimit(`privacy-export:${user.id}`, 3, 3600000).allowed) return Response.json({ error: "Повторите позже" }, { status: 429, headers });
  const [profile, orders, consents, requests, socialAccounts] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, phone: true, company: true, taxId: true, createdAt: true, addresses: { select: { label: true, city: true, postalCode: true, street: true, apartment: true, isDefault: true } } } }),
    prisma.order.findMany({ where: { userId: user.id }, select: { number: true, status: true, customerName: true, customerEmail: true, customerPhone: true, shippingAddress: true, customerComment: true, total: true, createdAt: true, items: { select: { productName: true, sku: true, quantity: true, unitPrice: true, configuration: true } }, shipment: { select: { provider: true, method: true, tracking: true, shippedAt: true, deliveredAt: true } } } }),
    prisma.privacyConsent.findMany({ where: { userId: user.id }, select: { purpose: true, version: true, document: true, createdAt: true, expiresAt: true, revokedAt: true } }),
    prisma.privacyRequest.findMany({ where: { userId: user.id }, select: { type: true, message: true, status: true, response: true, createdAt: true, updatedAt: true } }),
    prisma.socialAccount.findMany({ where: { userId: user.id }, select: { provider: true, subject: true, createdAt: true } }),
  ]);
  return Response.json({ exportedAt: new Date().toISOString(), profile, orders, consents, requests, socialAccounts }, { headers: { ...headers, "Content-Disposition": 'attachment; filename="3dprinta-personal-data.json"' } });
}
