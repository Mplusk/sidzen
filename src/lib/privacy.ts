import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getStoreContacts } from "@/lib/settings";
import { CONSENT_VERSION, CONSENT_TEXT } from "@/lib/privacy-documents";

export function privacySubject(...parts: string[]) {
  if (!process.env.AUTH_SECRET) throw new Error("privacy-key-missing");
  return createHmac("sha256", `${process.env.AUTH_SECRET}:privacy-v1`).update(JSON.stringify(parts)).digest("hex");
}
export async function consentDocument(purpose: keyof typeof CONSENT_TEXT) {
  const contacts = await getStoreContacts();
  if (!contacts.legalName || !contacts.legalAddress || !contacts.email) throw new Error("operator-incomplete");
  return { version: CONSENT_VERSION, purpose, text: CONSENT_TEXT[purpose], operator: { name: contacts.legalName, inn: contacts.inn, address: contacts.legalAddress, email: contacts.email }, url: `/legal/consent/?purpose=${purpose}` };
}
export async function operatorReady() {
  if (!rfStorageReady()) return false;
  const contacts = await getStoreContacts();
  return !!(contacts.legalName && contacts.legalAddress && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email));
}
// Infrastructure confirmation belongs to deployment, not a self-certification
// checkbox. Set only after checking the actual DB and backup locations.
export function rfStorageReady() { return process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED === "true"; }
export async function verifyDeliveryConsent(id: string, cartId: string, phone: string, db: Pick<typeof prisma, "privacyConsent"> = prisma) {
  const consent = id ? await db.privacyConsent.findUnique({ where: { id } }) : null;
  if (!consent || consent.purpose !== "ozon" || consent.version !== CONSENT_VERSION || consent.revokedAt || !consent.expiresAt || consent.expiresAt <= new Date() || consent.subjectHash !== privacySubject(cartId, phone)) throw new Error("delivery-consent-missing");
}
