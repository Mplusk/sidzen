import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FivePostClient } from "./fivepost-client";
import { catalogPoint, quoteIdentity, verifyFivePostQuote } from "./fivepost-quote";
import { activeFivePostGeneration, fivePostReady, fivePostScope, getFivePostConfig } from "./fivepost-config";

type Reader = Pick<typeof prisma, "fivePostDirectory" | "fivePostPoint" | "siteSetting">;
export async function fivePostDirectory(db: Reader = prisma) {
  const [config, directory] = await Promise.all([getFivePostConfig(db), db.fivePostDirectory.findUnique({ where: { id: "5post" } })]);
  return { config, generation: activeFivePostGeneration(config, directory) };
}
export async function selectedFivePostPoint(id: string, db: Reader = prisma) {
  const { config, generation } = await fivePostDirectory(db);
  if (!generation) throw new Error("fivepost-disabled");
  const point = await db.fivePostPoint.findUniqueOrThrow({ where: { generation_id: { generation, id } } });
  return { point, config };
}
export async function checkedFivePostSelection(token: string, cart: Parameters<typeof verifyFivePostQuote>[2], db: Reader = prisma) {
  const { id } = quoteIdentity(token);
  const { config, point } = await selectedFivePostPoint(id, db);
  return { ...verifyFivePostQuote(token, point, cart, config), warehouseId: config.warehouseId, senderLocation: config.senderLocation };
}
function nextRefresh(now: Date) {
  const next = new Date(now);
  next.setUTCHours(3, 15, 0, 0);
  if (next.getTime() - now.getTime() < 12 * 3600000) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
export async function syncFivePostPage() {
  const dir = await prisma.fivePostDirectory.findUnique({ where: { id: "5post" } });
  if (!dir || dir.nextAttemptAt.getTime() > Date.now()) return;
  const config = await getFivePostConfig();
  if (!fivePostReady(config) || fivePostScope(config) !== dir.scope) return;
  const lease = new Date(Date.now() + 60000);
  const version = { id: dir.id, scope: dir.scope, staging: dir.staging, page: dir.page };
  const claimed = await prisma.fivePostDirectory.updateMany({ where: { ...version, nextAttemptAt: dir.nextAttemptAt }, data: { nextAttemptAt: lease } });
  if (!claimed.count) return;
  try {
    const result = await new FivePostClient(config).points(dir.page);
    const complete = dir.page + 1 >= result.totalPages;
    if (!complete && !result.content.length) throw new Error("fivepost-empty-page");
    const points = result.content.map(row => catalogPoint(row, config, dir.staging)).filter(row => row !== null);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(53415001)`;
      if (!await tx.fivePostDirectory.findFirst({ where: { ...version, nextAttemptAt: lease } })) return;
      if (points.length) await tx.fivePostPoint.createMany({ data: points, skipDuplicates: true });
      if (!complete) {
        await tx.fivePostDirectory.update({ where: { id: dir.id }, data: { page: { increment: 1 }, error: null, nextAttemptAt: new Date(Date.now() + 1200) } });
        return;
      }
      const count = await tx.fivePostPoint.count({ where: { generation: dir.staging } });
      await tx.fivePostDirectory.update({ where: { id: dir.id }, data: { active: count ? dir.staging : null, staging: randomUUID(), page: 0, refreshedAt: new Date(), error: count ? null : "no-rates", nextAttemptAt: nextRefresh(new Date()) } });
      await tx.fivePostPoint.deleteMany({ where: { generation: { not: dir.staging } } });
    }, { timeout: 20000 });
  } catch (error) {
    const limited = error instanceof Error && error.message === "fivepost-http-429";
    await prisma.fivePostDirectory.updateMany({ where: { ...version, nextAttemptAt: lease }, data: { error: limited ? "rate-limit" : "unavailable", nextAttemptAt: new Date(Date.now() + (limited ? 65 : 10) * 60000) } });
  }
}
