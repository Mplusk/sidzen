/** Rendering aliases share data, but never share cookies across unrelated domains. */
export const STOREFRONT_HOSTS = ["3dprinta.shop", "sidzen.shop"] as const;
export function normalizedHost(value: string | null | undefined) {
  return (value ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}
export function usesSidzenDomain(value: string | null | undefined) {
  return ["sidzen.shop", "www.sidzen.shop"].includes(normalizedHost(value));
}
export function socialLoginHandoff(host: string | null | undefined, origin: string, returnTo: string, linking = false) {
  if (!usesSidzenDomain(host) || normalizedHost(host) === new URL(origin).host) return null;
  // Start the entire OAuth flow on the existing registered callback domain,
  // before creating a host-bound binding cookie. Do not forward passwords/state.
  const target = new URL(linking ? "/account/profile/" : "/login/", origin);
  if (!linking) target.searchParams.set("returnTo", returnTo);
  return target.href;
}
