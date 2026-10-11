import { describe, expect, it, vi } from "vitest";
import { getMapTile, mapTileUrl, TILE_CACHE_SECONDS } from "./map-tiles";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
describe("privacy-preserving map tile proxy", () => {
  it("only allows bounded public tile coordinates on the fixed HTTPS provider", () => {
    expect(mapTileUrl("15", "19959", "11814")).toBe("https://tile.openstreetmap.org/15/19959/11814.png");
    for (const params of [["2", "1", "1"], ["19", "1", "1"], ["3", "8", "0"], ["3", "0", "8"], ["3", "-1", "0"], ["3", "1.5", "0"], ["03", "1", "1"], ["3", "https://evil.test", "0"], ["3", "../", "0"]]) {
      expect(mapTileUrl(...params as [string, string, string])).toBeNull();
    }
  });
  it("fetches without visitor identifiers and caches for at least seven days", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(png, { headers: { "Content-Type": "image/png" } }));
    const response = await getMapTile("3", "1", "2", transport);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(response.headers.get("cache-control")).toBe(`public, max-age=${TILE_CACHE_SECONDS}`);
    expect(transport.mock.calls[0][1]).toMatchObject({ cache: "force-cache", next: { revalidate: 604800 }, redirect: "error", headers: { "User-Agent": "SIDZEN-PickupMap/1.0 (+https://sidzen.shop/contacts/)", Referer: "https://sidzen.shop/" } });
    expect(Object.keys(transport.mock.calls[0][1]!.headers!)).toEqual(["User-Agent", "Referer"]);
  });
  it("rejects invalid requests before contacting the provider", async () => {
    const transport = vi.fn<typeof fetch>();
    expect((await getMapTile("18", "999999", "0", transport)).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not relay upstream errors, HTML or oversized responses", async () => {
    for (const response of [new Response("private error", { status: 403 }), new Response("html", { headers: { "Content-Type": "text/html" } }), new Response("not-png", { headers: { "Content-Type": "image/png" } }), new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": "262145" } }), new Response(new Uint8Array(262145), { headers: { "Content-Type": "image/png" } })]) {
      const result = await getMapTile("3", "1", "2", vi.fn<typeof fetch>().mockResolvedValue(response));
      expect(result.status).toBe(502);
      expect(await result.text()).toBe("");
    }
    expect((await getMapTile("3", "1", "2", vi.fn<typeof fetch>().mockRejectedValue(new Error("private")))).status).toBe(502);
  });
});
