// Older checkout tabs can fall back to OpenStreetMap when this endpoint is gone.
export async function GET() {
  return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
}
