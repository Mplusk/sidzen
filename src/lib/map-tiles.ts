export const TILE_CACHE_SECONDS = 7 * 24 * 60 * 60;

export function mapTileUrl(z: string, x: string, y: string) {
  if (![z, x, y].every(value => /^(0|[1-9]\d{0,6})$/.test(value))) return null;
  const zoom = Number(z), column = Number(x), row = Number(y);
  if (zoom < 3 || zoom > 18 || column >= 2 ** zoom || row >= 2 ** zoom) return null;
  return `https://tile.openstreetmap.org/${zoom}/${column}/${row}.png`;
}

export async function getMapTile(z: string, x: string, y: string, transport: typeof fetch = fetch) {
  const url = mapTileUrl(z, x, y);
  if (!url) return new Response(null, { status: 400 });
  try {
    // Only public tile coordinates go to the provider. Never forward visitor
    // cookies, IP, query text, chosen PVZ, order IDs, or recipient information.
    const upstream = await transport(url, { cache: "force-cache", next: { revalidate: TILE_CACHE_SECONDS }, redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "3DPRINTA-PickupMap/1.0 (+https://3dprinta.shop/contacts/)", Referer: "https://3dprinta.shop/" } });
    if (!upstream.ok || !upstream.headers.get("content-type")?.startsWith("image/png") || Number(upstream.headers.get("content-length")) > 262144) return new Response(null, { status: 502 });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length > 262144 || bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return new Response(null, { status: 502 });
    return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${TILE_CACHE_SECONDS}`, "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 502 }); }
}
