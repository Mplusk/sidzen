// Old clients must never resume collecting personal visit events.
export function POST() { return new Response(null, { status: 410, headers: { "Cache-Control": "private, no-store" } }); }
