import { afterEach, expect, it, vi } from "vitest";

const { getMapTile } = vi.hoisted(() => ({ getMapTile: vi.fn() }));
vi.mock("@/lib/map-tiles", () => ({ getMapTile }));
import { GET } from "./route";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("allows map navigation, bounds sustained traffic and recovers after the window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T10:00:00Z"));
  getMapTile.mockImplementation(async () => new Response(null, { status: 200 }));
  const request = new Request("https://sidzen.shop/api/maps/tiles/10/619/320/", {
    headers: { "x-forwarded-for": "192.0.2.25" },
  });
  const context = { params: Promise.resolve({ z: "10", x: "619", y: "320" }) };
  for (let view = 0; view < 6; view++) {
    if (view) vi.advanceTimersByTime(10_000);
    for (let index = 0; index < 100; index++) expect((await GET(request, context)).status).toBe(200);
  }
  const limited = await GET(request, context);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(limited.headers.get("cache-control")).toBe("no-store");
  expect(getMapTile).toHaveBeenCalledTimes(600);
  vi.advanceTimersByTime(60_000);
  expect((await GET(request, context)).status).toBe(200);
  expect(getMapTile).toHaveBeenLastCalledWith("10", "619", "320");
});

it("blocks rapid bursts before fetching images without blocking a different visitor", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T11:00:00Z"));
  getMapTile.mockImplementation(async () => new Response(null, { status: 200 }));
  const request = (ip: string) => new Request("https://sidzen.shop/api/maps/tiles/10/619/320/", {
    headers: { "x-forwarded-for": ip },
  });
  const context = { params: Promise.resolve({ z: "10", x: "619", y: "320" }) };
  for (let index = 0; index < 120; index++) expect((await GET(request("192.0.2.26"), context)).status).toBe(200);
  const limited = await GET(request("192.0.2.26"), context);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("10");
  expect(limited.headers.get("cache-control")).toBe("no-store");
  expect(getMapTile).toHaveBeenCalledTimes(120);
  expect((await GET(request("192.0.2.27"), context)).status).toBe(200);
  vi.advanceTimersByTime(10_000);
  expect((await GET(request("192.0.2.26"), context)).status).toBe(200);
});
