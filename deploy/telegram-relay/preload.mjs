import { ProxyAgent } from "undici";

// Compatibility for immutable images built before telegram/transport.ts.
// This is a persistent read-only runtime mount, not an edit inside an image.
// New images pass their own dispatcher and are deliberately left untouched.
const uri = process.env.TELEGRAM_PROXY_URL?.trim();
if (uri) {
  const dispatcher = new ProxyAgent({ uri, connections: 2, connect: { timeout: 8000 } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return originalFetch(input, url.origin === "https://api.telegram.org" && !init?.dispatcher
      ? { ...init, dispatcher } : init);
  };
}
