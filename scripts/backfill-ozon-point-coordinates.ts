// Public directory maintenance only: no recipients, orders or location queries.
import { prisma } from "../src/lib/prisma";
import { getOzonDeliveryConfig, requireOzonDelivery } from "../src/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "../src/lib/delivery/ozon-client";

const config = await getOzonDeliveryConfig();
requireOzonDelivery(config);
const scope = { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId!), active: true };
const missing = await prisma.ozonDeliveryPoint.findMany({ where: { ...scope, OR: [{ latitude: null }, { longitude: null }] }, select: { id: true }, orderBy: { id: "asc" } });
let cursor = 0;
let completed = 0;
try {
  await Promise.all(Array.from({ length: 2 }, async () => {
    const api = new OzonDeliveryClient(config);
    await api.authorize();
    while (cursor < missing.length) {
      const batch = missing.slice(cursor, cursor += 100);
      let details: Awaited<ReturnType<typeof api.pointInfo>> | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { details = await api.pointInfo(batch.map(point => Number(point.id))); break; }
        catch { if (attempt === 4) throw new Error("Public directory refresh failed; rerun to resume remaining points."); await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt)); await api.authorize(); }
      }
      const allowed = new Set(batch.map(point => point.id));
      await prisma.$transaction(async tx => {
        for (const detail of details!) {
          if (!allowed.has(String(detail.delivery_point_id))) continue;
          if (!detail.is_active || detail.coordinates) await tx.ozonDeliveryPoint.updateMany({ where: { ...scope, id: String(detail.delivery_point_id) }, data: { active: detail.is_active, ...(detail.coordinates ? { latitude: detail.coordinates.latitude, longitude: detail.coordinates.longitude } : {}) } });
        }
      }, { timeout: 20000 });
      completed += batch.length;
      if (completed % 1000 === 0 || completed === missing.length) console.log(`Public coordinate refresh: ${completed}/${missing.length}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }));
} finally { await prisma.$disconnect(); }
