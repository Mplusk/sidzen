import { cache } from "react";
import { prisma } from "@/lib/prisma";

export const getSettings = cache(async () => {
  const rows = await prisma.siteSetting.findMany({ where: { group: { not: "integrations" } } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
});

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await getSettings();
  return (settings[key] as T | undefined) ?? fallback;
}

export async function getStoreContacts() {
  const settings = await getSettings();
  const read = (key: string) => typeof settings[key] === "string" ? (settings[key] as string).trim() : "";
  // Old seed placeholders are not verified company contacts.
  return { phone: read("contacts.phone") === "+7 (800) 301-30-03" ? "" : read("contacts.phone"), email: read("contacts.email") === "hello@3dprinta.shop" ? "" : read("contacts.email"), address: read("contacts.address"), hours: read("contacts.hours"), legalName: read("legal.seller"), inn: read("legal.inn"), ogrn: read("legal.ogrn"), legalAddress: read("legal.address"), bank: read("legal.bank"), about: read("store.about") };
}
