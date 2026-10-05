import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWebhookBody } from "./webhook";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const claims = { webhookType: "acquiringInternetPayment", operationId: "bank-op", paymentLinkId: "payment-1", customerCode: "1234567ab", merchantId: "200000000001097" };
function jwt(value: object = claims, privateKey = keys.privateKey, alg = "RS256") {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url"), body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url")}`;
}
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
describe("Tochka signed text/plain notifications", () => {
  it("verifies RS256 against the official key endpoint and caches the public key", async () => {
    const bank = vi.fn().mockResolvedValue(Response.json(keys.publicKey.export({ format: "jwk" }))); vi.stubGlobal("fetch", bank);
    const { verifyTochkaWebhook } = await import("./webhook");
    expect(await verifyTochkaWebhook(jwt())).toEqual(claims); expect(await verifyTochkaWebhook(jwt())).toEqual(claims);
    expect(bank).toHaveBeenCalledTimes(1); expect(bank.mock.calls[0][0]).toBe("https://enter.tochka.com/doc/openapi/static/keys/public");
  });
  it("rejects forged signatures, tampering, unsigned JWT and a different algorithm", async () => {
    const bank = vi.fn().mockImplementation(async () => Response.json(keys.publicKey.export({ format: "jwk" }))); vi.stubGlobal("fetch", bank);
    const { verifyTochkaWebhook } = await import("./webhook");
    await expect(verifyTochkaWebhook(jwt(claims, other.privateKey))).rejects.toThrow("webhook-signature");
    await expect(verifyTochkaWebhook(jwt().replace(jwt().split(".")[1], Buffer.from(JSON.stringify({ ...claims, operationId: "evil" })).toString("base64url")))).rejects.toThrow("webhook-signature");
    await expect(verifyTochkaWebhook("eyJhbGciOiJub25lIn0.e30.")).rejects.toThrow();
    await expect(verifyTochkaWebhook(jwt(claims, keys.privateKey, "HS256"))).rejects.toThrow();
  });
  it("rejects expired or not-yet-valid signed notifications", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(keys.publicKey.export({ format: "jwk" }))));
    const { verifyTochkaWebhook } = await import("./webhook");
    await expect(verifyTochkaWebhook(jwt({ ...claims, exp: 1 }))).rejects.toThrow("webhook-expired");
    await expect(verifyTochkaWebhook(jwt({ ...claims, nbf: Math.floor(Date.now() / 1000) + 600 }))).rejects.toThrow("webhook-expired");
  });
  it("caps both declared and chunked request bodies", async () => {
    await expect(readWebhookBody(new Request("https://shop.example/api", { method: "POST", body: "x", headers: { "content-length": "32769" } }))).rejects.toThrow("webhook-too-large");
    await expect(readWebhookBody(new Request("https://shop.example/api", { method: "POST", body: "x".repeat(32769) }))).rejects.toThrow("webhook-too-large");
    expect(await readWebhookBody(new Request("https://shop.example/api", { method: "POST", body: ` ${jwt()}\n`, headers: { "Content-Type": "text/plain" } }))).toBe(jwt());
  });
});
