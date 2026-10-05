import { OzonDeliveryClient, OzonDeliveryError } from "./ozon-client";

// One budget for OAuth, PVZ info, recipient check, quote, redirects and retries.
// Only quote reads are allowed by this client; mutations keep their existing queue.
export const OZON_QUOTE_BUDGET_MS = 45_000;
export async function retryOzonQuote<T>(credentials: { clientId: string; clientSecret: string }, work: (api: OzonDeliveryClient) => Promise<T>) {
  const deadline = Date.now() + OZON_QUOTE_BUDGET_MS;
  const api = new OzonDeliveryClient(credentials, fetch, deadline);
  for (let attempts = 1; ; attempts++) {
    try { return { value: await work(api), attempts }; }
    catch (error) {
      if (!(error instanceof OzonDeliveryError)) throw error;
      error.attempts = attempts;
      const delay = attempts * 500;
      if (attempts >= 3 || (error.code !== "transport" && !error.retryable) || Date.now() + delay >= deadline) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
}
