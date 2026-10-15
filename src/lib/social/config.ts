import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const providers = ["google", "vk", "yandex"] as const;
// Retired storefront feature; archived bindings remain until lawful erasure.
export function socialLoginEnabled() { return false; }
export const providerSchema = z.enum(providers);
export type SocialProvider = z.infer<typeof providerSchema>;
export const providerNames = { google: "Google", vk: "ВКонтакте", yandex: "Яндекс" };
export const configSchema = z.object({ enabled: z.boolean(), clientId: z.string().max(256).regex(/^[A-Za-z0-9._-]*$/), clientSecret: z.string().max(2048), operatorReviewed: z.boolean(), revision: z.string().max(100) });
export type SocialConfig = z.infer<typeof configSchema>;
export const settingKey = (provider: SocialProvider) => `auth.social.${provider}`;
export async function getSocialConfig(provider: SocialProvider, db: Pick<typeof prisma, "siteSetting"> = prisma): Promise<SocialConfig> {
  const row = await db.siteSetting.findUnique({ where: { key: settingKey(provider) } });
  if (!row) return { enabled: false, clientId: "", clientSecret: "", operatorReviewed: false, revision: "" };
  const stored = configSchema.extend({ clientSecret: z.string().max(4096) }).parse(row.value);
  return configSchema.parse({ ...stored, clientSecret: stored.clientSecret ? decryptSecret(stored.clientSecret, settingKey(provider)) : "" });
}
export function socialReady(provider: SocialProvider, config: SocialConfig) {
  const idValid = provider === "google" ? /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId) : provider === "vk" ? /^[1-9][0-9]{1,18}$/.test(config.clientId) : /^[a-f0-9]{32}$/i.test(config.clientId);
  return config.enabled && config.operatorReviewed && Boolean(config.revision) && idValid && (provider === "vk" || Boolean(config.clientSecret.trim())) && (provider !== "google" || process.env.GOOGLE_OAUTH_LEGAL_APPROVED === "true");
}
export function siteOrigin() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (!local && (url.origin !== "https://sidzen.shop")) || !["http:", "https:"].includes(url.protocol)) throw new Error("social-site-url");
  return url.origin;
}
export const callbackUrl = (provider: SocialProvider) => `${siteOrigin()}/api/auth/social/${provider}/callback/`;
export function safeSocialReturn(value: unknown) {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x20\x7f]/.test(path) || path.length > 1000) return "/account/";
  const url = new URL(path, "https://sidzen.shop");
  return url.origin === "https://sidzen.shop" ? `${url.pathname}${url.search}${url.hash}` : "/account/";
}
