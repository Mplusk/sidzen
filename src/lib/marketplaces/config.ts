import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";
import { connectionKey, connectionSchema, policySchema, POLICY_KEY, type Provider } from "./model";

type Database = Pick<Prisma.TransactionClient, "siteSetting">;
export async function getConnection(provider: Provider, database: Database = prisma) {
  const row = await database.siteSetting.findUnique({ where: { key: connectionKey(provider) } });
  if (!row) return null;
  const config = connectionSchema.parse(row.value);
  return { ...config, secret: decryptSecret(config.secret, connectionKey(provider)) };
}
export async function getPolicy(database: Database = prisma) {
  const row = await database.siteSetting.findUnique({ where: { key: POLICY_KEY } });
  return policySchema.parse(row?.value ?? {});
}
