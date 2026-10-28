import { ProxyAgent, type Dispatcher } from "undici";

let cached: { uri: string; dispatcher: Dispatcher } | undefined;

// This dispatcher is deliberately local to Telegram. Never install a global
// proxy: bank, delivery, customer data and other integrations stay unchanged.
export const telegramFetch: typeof fetch = async (input, init) => {
  const uri = process.env.TELEGRAM_PROXY_URL?.trim();
  if (!uri) return fetch(input, init);
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== "https://api.telegram.org" || target.username || target.password) throw new Error("telegram-target");
  const proxy = new URL(uri);
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error("telegram-proxy-config");
  if (!cached || cached.uri !== uri) {
    const previous = cached;
    cached = { uri, dispatcher: new ProxyAgent({ uri, connections: 2, connect: { timeout: 8000 } }) };
    void previous?.dispatcher.close().catch(() => {});
  }
  return fetch(input, { ...init, dispatcher: cached.dispatcher } as RequestInit);
};
