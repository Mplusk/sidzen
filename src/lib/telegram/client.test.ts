import { expect, it, vi } from "vitest";
import { sendTelegram, verifyTelegram, telegramOrderText, telegramPrivateOrderText, telegramOrderStatusText, telegramChatType, TelegramError } from "./client";
const config = { enabled: true, token: "12345:fixture-secret", chatId: "-10012345", revision: "qa", checkedAt: "2030" };
it("sends only an authenticated opaque admin link, no buyer data or preview", async () => {
  const text = telegramOrderText("opaque-ref", "https://sidzen.shop");
  const transport = vi.fn().mockResolvedValue(new Response('{"ok":true,"result":{}}'));
  await sendTelegram(config, text, transport);
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ chat_id: config.chatId, text, link_preview_options: { is_disabled: true }, protect_content: true });
  expect(text).toContain("https://sidzen.shop/admin/order-alert/opaque-ref/");
  expect(transport.mock.calls[0][1].redirect).toBe("error");
});
it("verifies bot/chat read-only without sending a message", async () => {
  const transport = vi.fn().mockResolvedValueOnce(new Response('{"ok":true,"result":{}}')).mockResolvedValueOnce(new Response('{"ok":true,"result":{"id":-10012345,"type":"supergroup"}}'));
  await verifyTelegram(config, transport); expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls.map(call => call[0].split("/").at(-1))).toEqual(["getMe", "getChat"]);
});
it("does not leak provider responses/token and does not blindly retry ambiguous sends", async () => {
  await expect(sendTelegram(config, "test", vi.fn().mockRejectedValue(new Error("secret-token")))).rejects.toEqual(new TelegramError("uncertain"));
  await expect(sendTelegram(config, "test", vi.fn().mockResolvedValue(new Response('{"ok":false,"description":"secret-token"}', { status: 403 })))).rejects.toEqual(new TelegramError("recipient"));
  await expect(sendTelegram(config, "test", vi.fn().mockResolvedValue(new Response('{"ok":false,"parameters":{"retry_after":60}}', { status: 429 })))).rejects.toEqual(new TelegramError("rate", true, 60000));
});
it.each(["http://sidzen.shop", "https://evil.test", "https://sidzen.shop:444", "https://secret@sidzen.shop"])("refuses untrusted alert origins: %s", url => { expect(() => telegramOrderText("id", url)).toThrow(TelegramError); });
it("includes requested order details but never the full address", () => {
  const order = { id: "opaque", number: "ORDER-1", shippingAddress: "123456, Москва, ул. Тестовая, д. 42", subtotal: 480, deliveryPrice: 100, total: 580, shipment: { provider: "russian-post", cost: 150 }, items: [{ productName: "Изделие", quantity: 2, totalPrice: 480 }] };
  const text = telegramPrivateOrderText(order, "https://sidzen.shop");
  expect(text).toContain("ORDER-1"); expect(text).toContain("Изделие × 2"); expect(text).toContain("Город: Москва");
  expect(text).toContain("480"); expect(text).toContain("100"); expect(text).toContain("150"); expect(text).toContain("580");
  expect(text).not.toContain("Тестовая"); expect(text).not.toContain("123456");
  expect(telegramPrivateOrderText({ ...order, shippingAddress: "ул. Садовая, дом 2", shipment: { provider: "ozon-delivery", cost: 0 } }, "https://sidzen.shop")).toContain("Город: не указан");
});
it("verifies chat identity before distinguishing a private recipient", async () => {
  const privateChat = { ...config, chatId: "12345" };
  const transport = vi.fn().mockImplementation(async () => new Response('{"ok":true,"result":{"id":12345,"type":"private"}}'));
  expect(await telegramChatType(privateChat, transport)).toBe("private");
  await expect(telegramChatType({ ...privateChat, chatId: "12346" }, transport)).rejects.toEqual(new TelegramError("recipient"));
});
it.each([
  ["Россия, Санкт-Петербург, Беговая улица, 3", "Санкт-Петербург"],
  ["Россия, Москва, Ленинский проспект, 23", "Москва"],
  ["Россия, Москва, 2-я Фрунзенская улица, 10", "Москва"],
  ["Россия, Адыгея Республика, Тахтамукайский Район, Яблоновский, улица Андрухаева, 53", "Яблоновский"],
])("shows the city but not the full Ozon address", (address, city) => {
  const order = { id: "opaque", number: "ORDER-1", shippingAddress: address, subtotal: 240, deliveryPrice: 0, total: 240, shipment: { provider: "ozon-delivery", cost: 110 }, items: [{ productName: "Товар", quantity: 1, totalPrice: 240 }] };
  const text = telegramPrivateOrderText(order, "https://sidzen.shop");
  expect(text).toContain(`Город: ${city}`); expect(text).not.toContain(address);
});
it("uses the purchased group label and chosen color without duplicating them", () => {
  const order = { id: "opaque", number: "ORDER-1", shippingAddress: null, subtotal: 600, deliveryPrice: 0, total: 600, shipment: null, items: [
    { productName: "Крючки", quantity: 1, totalPrice: 300, groupLabel: "Чёрный", product: { groupId: "group", groupLabel: "Изменён позднее" }, configuration: { colorName: "Чёрный" } },
    { productName: "Полотенце", quantity: 1, totalPrice: 300, groupLabel: null, product: { groupId: "group", groupLabel: "Большое" }, configuration: { colorName: "Бежевый" } },
    { productName: "Крючки", quantity: 1, totalPrice: 300, groupLabel: "300301", productColor: "Белый", configuration: {}, product: { groupId: "group", groupLabel: "300301", specifications: { "Цвет товара": "Розовый" } } },
    { productName: "Старый заказ", quantity: 1, totalPrice: 300, groupLabel: null, configuration: {}, product: { groupId: "group", groupLabel: "300302", specifications: { "Цвет товара": "Синий" } } },
  ] };
  const text = telegramPrivateOrderText(order, "https://sidzen.shop");
  expect(text).toContain("Цвет: Чёрный"); expect(text).not.toContain("Изменён позднее");
  expect(text).toContain("Вариант: Большое · Цвет: Бежевый");
  expect(text).toContain("Вариант: 300301 · Цвет: Белый");
  expect(text).toContain("Вариант: 300302 · Цвет: Синий");
  expect(text).not.toContain("Розовый");
  expect(text.match(/Чёрный/g)).toHaveLength(1);
});
it("prefers the color chosen for the order over the product's default color", () => {
  const order = { id: "opaque", number: "ORDER-1", shippingAddress: null, subtotal: 100, deliveryPrice: 0, total: 100, shipment: null, items: [
    { productName: "Товар", quantity: 1, totalPrice: 100, groupLabel: "Размер M", productColor: "Белый", configuration: { color: "cobalt" } },
  ] };
  const text = telegramPrivateOrderText(order, "https://sidzen.shop");
  expect(text).toContain("Вариант: Размер M · Цвет: Кобальт"); expect(text).not.toContain("Белый");
});
it("bounds long item lists and announces cancellation without leaking details to groups", () => {
  const order = { id: "opaque", number: "ORDER-1", shippingAddress: null, subtotal: 100, deliveryPrice: 0, total: 100, shipment: null, items: Array.from({ length: 100 }, () => ({ productName: "А".repeat(200), groupLabel: "Б".repeat(180), quantity: 1, totalPrice: 1 })) };
  const text = telegramPrivateOrderText(order, "https://sidzen.shop");
  expect(text.length).toBeLessThan(4096); expect(text).toContain("и ещё");
  const status = { id: "opaque", number: "ORDER-1", reservationExpiredAt: new Date(), stockReviewRequired: false };
  expect(telegramOrderStatusText(status, "CANCELED", "https://sidzen.shop", true)).toContain("ORDER-1 отменён");
  expect(telegramOrderStatusText(status, "CANCELED", "https://sidzen.shop", false)).not.toContain("ORDER-1");
  expect(telegramOrderStatusText({ ...status, stockReviewRequired: true }, "LATE_PAYMENT", "https://sidzen.shop", true)).toContain("проверить наличие");
});
