import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const payment = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/yookassa/config", () => ({
  getYooKassaConfig: async () => payment,
  yookassaReady: (config: typeof payment) => config.enabled,
}));
import FaqPage from "./page";

describe("FAQ checkout wording", () => {
  it.each([false, true])("matches the active payment mode in visible content and structured data: %s", async (enabled) => {
    payment.enabled = enabled;
    const html = renderToStaticMarkup(await FaqPage());
    const answer = enabled ? "Для оплаты заказа используется ЮKassa" : "Отправка заявки ничего не списывает";
    expect(html.split(answer)).toHaveLength(3);
    expect(html).not.toContain(enabled ? "Отправка заявки ничего не списывает" : "Для оплаты заказа используется ЮKassa");
  });
});

