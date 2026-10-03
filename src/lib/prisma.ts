import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const connectionLimit = Number(process.env.SHOP_DB_CONNECTION_LIMIT);
const databaseUrl = process.env.DATABASE_URL && Number.isInteger(connectionLimit) && connectionLimit >= 1 && connectionLimit <= 20 ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl) databaseUrl.searchParams.set("connection_limit", String(connectionLimit));

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl.toString() } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
