import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ constructor: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }));
vi.mock("undici", () => ({ ProxyAgent: class { close = mocks.close; constructor(options: unknown) { mocks.constructor(options); } } }));
import { telegramFetch } from "./transport";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("uses the dedicated proxy without changing global fetch or TLS verification", async () => {
  vi.stubEnv("TELEGRAM_PROXY_URL", "http://127.0.0.1:18443");
  const fetcher = vi.fn().mockResolvedValue(new Response("ok")); vi.stubGlobal("fetch", fetcher);
  await telegramFetch("https://api.telegram.org/botfixture/getMe", { method: "POST" });
  expect(mocks.constructor).toHaveBeenCalledWith({ uri: "http://127.0.0.1:18443", connections: 2, connect: { timeout: 8000 } });
  expect(fetcher.mock.calls[0][1].dispatcher).toBeDefined();
  expect(fetcher.mock.calls[0][1].method).toBe("POST");
});
it("fails closed for other destinations and malformed proxy configuration", async () => {
  vi.stubEnv("TELEGRAM_PROXY_URL", "http://127.0.0.1:18444");
  await expect(telegramFetch("https://example.com/")).rejects.toThrow("telegram-target");
  vi.stubEnv("TELEGRAM_PROXY_URL", "http://127.0.0.1:18444/other");
  await expect(telegramFetch("https://api.telegram.org/")).rejects.toThrow("telegram-proxy-config");
});
it("preserves ordinary direct transport when no Telegram proxy is configured", async () => {
  vi.stubEnv("TELEGRAM_PROXY_URL", ""); const fetcher = vi.fn().mockResolvedValue(new Response("ok")); vi.stubGlobal("fetch", fetcher);
  await telegramFetch("https://api.telegram.org/", { method: "GET" });
  expect(fetcher).toHaveBeenCalledWith("https://api.telegram.org/", { method: "GET" });
});
