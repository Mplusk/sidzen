/** Only SIDZEN is a storefront; unrelated domains never share cookies. */
export const STOREFRONT_HOSTS = ["sidzen.shop"] as const;
export function normalizedHost(value: string | null | undefined) {
  return (value ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}
export function usesSidzenDomain(value: string | null | undefined) {
  return ["sidzen.shop", "www.sidzen.shop"].includes(normalizedHost(value));
}
export function socialLoginHandoff(host: string | null | undefined, origin: string, returnTo: string, linking = false) {
  const callbackOrigin = new URL(origin);
  if (!usesSidzenDomain(host) || callbackOrigin.origin !== "https://sidzen.shop" || normalizedHost(host) === callbackOrigin.host) return null;
  // Normalize www before creating a host-bound OAuth cookie. Never hand off
  // to an unrelated origin, even if the environment was misconfigured.
  const target = new URL(linking ? "/account/profile/" : "/login/", origin);
  if (!linking) target.searchParams.set("returnTo", returnTo);
  return target.href;
}
