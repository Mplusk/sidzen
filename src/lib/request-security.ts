export function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host");
  if (!host) return false;

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host && (originUrl.protocol === "https:" || process.env.NODE_ENV !== "production");
  } catch {
    return false;
  }
}
