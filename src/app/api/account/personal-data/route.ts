export const dynamic = "force-dynamic";

// Retired endpoint: no authentication or database access, and no personal data.
export function GET() {
  return new Response(null, { status: 410, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}
