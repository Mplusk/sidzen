import { expect, it, vi } from "vitest";
import { sendTelegram, verifyTelegram, telegramOrderText, TelegramError } from "./client";
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
