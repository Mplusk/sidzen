import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/yandex-maps/config", () => ({ getYandexMapsConfig: m.config }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
import { GET } from "./route";
const request = () => new Request("https://sidzen.shop/api/maps/yandex-config/");
beforeEach(() => { vi.resetAllMocks(); m.rate.mockReturnValue({ allowed: true }); });
describe("browser map configuration", () => {
  it("returns the browser key without caching", async () => {
    m.config.mockResolvedValue({ apiKey: "test-browser-key", revision: "internal" });
    const response = await GET(request());
    expect(await response.json()).toEqual({ apiKey: "test-browser-key" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("falls back safely when configuration fails or the request is limited", async () => {
    m.config.mockRejectedValue(new Error("private"));
    expect(await (await GET(request())).json()).toEqual({ apiKey: "" });
    m.rate.mockReturnValue({ allowed: false });
    expect((await GET(request())).status).toBe(429);
  });
});
