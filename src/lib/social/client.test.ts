import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authorizationUrl, exchangeProfile, pkceChallenge } from "./client";
import type { SocialConfig } from "./config";
const config: SocialConfig = { enabled: true, operatorReviewed: true, clientId: "fixture-client", clientSecret: "fixture-secret", revision: "fixture" };
const input = { code: "fixture-code", verifier: "v".repeat(43), state: "state", nonce: "nonce", deviceId: "device" };
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
let keys: Awaited<ReturnType<typeof generateKeyPair>>, jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => { keys = await generateKeyPair("RS256"); jwk = { ...await exportJWK(keys.publicKey), kid: "fixture", alg: "RS256", use: "sig" }; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("social OAuth transports", () => {
  it("uses fixed provider endpoints, PKCE and minimal scopes without secrets", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sidzen.shop");
    for (const provider of ["google", "vk", "yandex"] as const) {
      const url = new URL(authorizationUrl(provider, config, "state", input.verifier, "nonce"));
      expect(url.protocol).toBe("https:"); expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(input.verifier));
      expect(url.searchParams.get("state")).toBe("state"); expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.toString()).not.toContain("fixture-secret"); expect(url.searchParams.get("scope")).not.toContain("phone");
    }
  });
  it("checks Yandex application binding and never puts tokens in request URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ access_token: "fixture-token" })).mockResolvedValueOnce(reply({ id: "user", client_id: config.clientId, real_name: "QA User", default_email: "USER@example.test", avatar: "https://unused" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await exchangeProfile("yandex", config, input)).toEqual({ subject: "user", name: "QA User", email: "user@example.test" });
    expect(fetchMock.mock.calls[1][0]).not.toContain("fixture-token"); expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: "OAuth fixture-token" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
    fetchMock.mockResolvedValueOnce(reply({ access_token: "fixture-token" })).mockResolvedValueOnce(reply({ id: "user", client_id: "other" }));
    await expect(exchangeProfile("yandex", config, input)).rejects.toThrow("client-mismatch");
  });
  it("requires VK device/state and binds user_info to token subject", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ access_token: "fixture-token", state: "state", user_id: 15 })).mockResolvedValueOnce(reply({ user: { user_id: "15", first_name: "QA", last_name: "User", email: "" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await exchangeProfile("vk", config, input)).toEqual({ subject: "15", name: "QA User", email: "" });
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe(input.verifier); expect(body.get("device_id")).toBe("device"); expect(body.has("client_secret")).toBe(false);
    await expect(exchangeProfile("vk", config, { ...input, deviceId: "" })).rejects.toThrow("device");
    fetchMock.mockResolvedValueOnce(reply({ access_token: "fixture-token", state: "other", user_id: 15 }));
    await expect(exchangeProfile("vk", config, input)).rejects.toThrow("state-mismatch");
    fetchMock.mockResolvedValueOnce(reply({ access_token: "fixture-token", state: "state", user_id: 15 })).mockResolvedValueOnce(reply({ user: { user_id: 16 } }));
    await expect(exchangeProfile("vk", config, input)).rejects.toThrow("subject-mismatch");
  });
  it("validates Google signature, issuer, audience, expiry and nonce", async () => {
    const make = async (claims: Record<string, unknown> = {}, signer = keys.privateKey) => new SignJWT({ nonce: input.nonce, name: "QA User", email: "qa@example.test", email_verified: true, ...claims }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://accounts.google.com").setAudience(config.clientId).setSubject("google-user").setIssuedAt().setExpirationTime("5m").sign(signer);
    const fetchMock = vi.fn(async (url: string | URL) => String(url).includes("certs") ? reply({ keys: [jwk] }) : reply({ id_token: await make() }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await exchangeProfile("google", config, input)).toEqual({ subject: "google-user", name: "QA User", email: "qa@example.test" });
    for (const claims of [{ nonce: "wrong" }, { azp: "wrong" }]) {
      fetchMock.mockImplementation(async url => String(url).includes("certs") ? reply({ keys: [jwk] }) : reply({ id_token: await make(claims) }));
      await expect(exchangeProfile("google", config, input)).rejects.toThrow("binding");
    }
    const wrongKeys = await generateKeyPair("RS256");
    fetchMock.mockImplementation(async () => reply({ id_token: await make({}, wrongKeys.privateKey) }));
    await expect(exchangeProfile("google", config, input)).rejects.toThrow();
    const invalid = await new SignJWT({ nonce: input.nonce }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://evil.test").setAudience(config.clientId).setSubject("user").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
    fetchMock.mockImplementation(async () => reply({ id_token: invalid })); await expect(exchangeProfile("google", config, input)).rejects.toThrow();
    const expired = await new SignJWT({ nonce: input.nonce }).setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://accounts.google.com").setAudience("other-app").setSubject("user").setIssuedAt().setExpirationTime(1).sign(keys.privateKey);
    fetchMock.mockImplementation(async () => reply({ id_token: expired })); await expect(exchangeProfile("google", config, input)).rejects.toThrow();
  });
  it("does not leak provider errors or persist extra profile fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "private-token-and-user-email" })));
    await expect(exchangeProfile("yandex", config, input)).rejects.toThrow("social-provider-response");
  });
});
