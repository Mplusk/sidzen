import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function writeAudit(input: {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}) {
  const headerStore = await headers();
  return prisma.auditLog.create({
    data: {
      ...input,
      ip: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim(),
    },
  });
}
