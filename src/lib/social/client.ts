import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { callbackUrl, type SocialConfig, type SocialProvider } from "./config";

export const profileSchema = z.object({ subject: z.string().min(1).max(255), name: z.string().max(120), email: z.string().max(254) });
export type SocialProfile = z.infer<typeof profileSchema>;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10000 });
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export function authorizationUrl(provider: SocialProvider, config: SocialConfig, state: string, verifier: string, nonce: string) {
  const url = new URL({ google: "https://accounts.google.com/o/oauth2/v2/auth", vk: "https://id.vk.ru/authorize", yandex: "https://oauth.yandex.ru/authorize" }[provider]);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: callbackUrl(provider), response_type: "code", state, code_challenge: pkceChallenge(verifier), code_challenge_method: provider === "vk" ? "s256" : "S256", scope: { google: "openid email profile", vk: "email", yandex: "login:info login:email" }[provider] }).toString();
  if (provider === "google") { url.searchParams.set("nonce", nonce); url.searchParams.set("prompt", "select_account"); }
  if (provider === "vk") url.searchParams.set("app_id", config.clientId);
  return url.toString();
}
async function json(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("social-provider-unavailable");
  // Never include provider bodies (tokens / PII) in logs or exceptions.
  const body = await response.text();
  if (body.length > 65536) throw new Error("social-provider-response");
  const data = JSON.parse(body);
  if (!data || typeof data !== "object" || data.error) throw new Error("social-provider-response");
  return data;
}
const post = (url: string, fields: Record<string, string>) => json(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
export async function exchangeProfile(provider: SocialProvider, config: SocialConfig, input: { code: string; verifier: string; state: string; nonce: string; deviceId: string }) : Promise<SocialProfile> {
  const fields: Record<string, string> = { grant_type: "authorization_code", code: input.code, client_id: config.clientId, redirect_uri: callbackUrl(provider), code_verifier: input.verifier };
  if (provider !== "vk") fields.client_secret = config.clientSecret;
  if (provider === "vk") { if (!input.deviceId || input.deviceId.length > 512) throw new Error("social-device-missing"); fields.device_id = input.deviceId; fields.state = input.state; }
  const tokens = await post({ google: "https://oauth2.googleapis.com/token", vk: "https://id.vk.ru/oauth2/auth", yandex: "https://oauth.yandex.ru/token" }[provider], fields);
  let subject: unknown, name: unknown, email: unknown;
  if (provider === "google") {
    if (typeof tokens.id_token !== "string") throw new Error("social-token-missing");
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce"], maxTokenAge: "10m", clockTolerance: 30 });
    if (payload.nonce !== input.nonce || (payload.azp && payload.azp !== config.clientId)) throw new Error("social-token-binding");
    subject = payload.sub; name = payload.name; email = payload.email_verified === true ? payload.email : "";
  } else {
    if (typeof tokens.access_token !== "string" || tokens.access_token.length > 8192) throw new Error("social-token-missing");
    if (provider === "vk") {
      if (tokens.state !== input.state) throw new Error("social-state-mismatch");
      const data = await post("https://id.vk.ru/oauth2/user_info", { access_token: tokens.access_token, client_id: config.clientId });
      if (!data.user || !data.user.user_id || String(tokens.user_id) !== String(data.user.user_id)) throw new Error("social-subject-mismatch");
      subject = String(data.user.user_id); name = [data.user.first_name, data.user.last_name].filter(v => typeof v === "string").join(" "); email = data.user.email;
    } else {
      const data = await json("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${tokens.access_token}` } });
      if (data.client_id !== config.clientId) throw new Error("social-client-mismatch");
      subject = data.id; name = data.real_name || data.display_name; email = data.default_email;
    }
  }
  return profileSchema.parse({ subject, name: typeof name === "string" ? name.trim().slice(0, 120) : "", email: typeof email === "string" && z.email().safeParse(email).success ? email.trim().toLowerCase().slice(0, 254) : "" });
}
