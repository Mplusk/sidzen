import { createHash } from "node:crypto";
export function catalogInvalidationToken() {
  if (!process.env.AUTH_SECRET) throw new Error("auth-secret-missing");
  return createHash("sha256").update(`3dprinta:catalog-invalidation:${process.env.AUTH_SECRET}`).digest("hex");
}
