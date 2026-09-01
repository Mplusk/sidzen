import { cache } from "react";
import { prisma } from "@/lib/prisma";

export const getSettings = cache(async () => {
  const rows = await prisma.siteSetting.findMany();
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await getSettings();
  return (settings[key] as T | undefined) ?? fallback;
}
