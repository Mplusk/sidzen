import { afterEach, expect, it, vi } from "vitest";
vi.mock("undici", () => ({ ProxyAgent: class {} }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
it("proxies only Telegram and respects dispatchers supplied by newer images", async () => {
  vi.stubEnv("TELEGRAM_PROXY_URL", "http://127.0.0.1:18443");
  const native = vi.fn().mockResolvedValue(new Response("ok")); vi.stubGlobal("fetch", native);
  await import("./preload.mjs");
  await globalThis.fetch("https://api.telegram.org/botfixture/getMe", { method: "POST" });
  expect(native.mock.calls[0][1].dispatcher).toBeDefined();
  const options = { method: "GET" }; await globalThis.fetch("https://example.com/", options);
  expect(native.mock.calls[1][1]).toBe(options);
  const explicit = { dispatcher: {} }; await globalThis.fetch("https://api.telegram.org/", explicit);
  expect(native.mock.calls[2][1]).toBe(explicit);
});
it("leaves fetch unchanged without the dedicated Telegram configuration", async () => {
  vi.stubEnv("TELEGRAM_PROXY_URL", ""); const native = vi.fn(); vi.stubGlobal("fetch", native);
  await import("./preload.mjs"); expect(globalThis.fetch).toBe(native);
});
