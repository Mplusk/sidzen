import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), send: vi.fn(), close: vi.fn(), config: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: m.create } }));
vi.mock("@/lib/smtp/config", () => ({ SMTP_ADDRESS: "support@sidzen.shop", getSmtpConfig: m.config }));
import { sendTransactionalMail, verifySmtp } from "./client";

beforeEach(() => {
  vi.resetAllMocks();
  m.create.mockReturnValue({ verify: m.verify, sendMail: m.send, close: m.close });
  m.verify.mockResolvedValue(true); m.send.mockResolvedValue({ accepted: ["buyer@example.com"], rejected: [] });
  m.config.mockResolvedValue({ password: "fixture-secret", checkedAt: "2026-01-01" });
});

it("checks SpaceWeb with certificate validation and never sends a test message", async () => {
  await verifySmtp("fixture-secret");
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.spaceweb.ru", port: 465, secure: true, auth: { user: "support@sidzen.shop", pass: "fixture-secret" }, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true }));
  expect(m.verify).toHaveBeenCalledOnce(); expect(m.send).not.toHaveBeenCalled(); expect(m.close).toHaveBeenCalledOnce();
});

it("requires a verified connection and sends only validated text with fixed sender", async () => {
  await sendTransactionalMail({ to: "buyer@example.com", subject: "Тема", text: "Текст" });
  expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ from: { name: "SIDZEN", address: "support@sidzen.shop" }, to: "buyer@example.com", text: "Текст" }));
  m.config.mockResolvedValueOnce({ password: "fixture-secret", checkedAt: null });
  await expect(sendTransactionalMail({ to: "buyer@example.com", subject: "Тема", text: "Текст" })).rejects.toThrow("smtp-not-configured");
  await expect(sendTransactionalMail({ to: "buyer@example.com\nBcc:other@example.com", subject: "Тема", text: "Текст" })).rejects.toThrow();
  await expect(sendTransactionalMail({ to: "buyer@example.com", subject: "Тема\r\nBcc: other@example.com", text: "Текст" })).rejects.toThrow();
  expect(m.send).toHaveBeenCalledTimes(1);
});

it("hides provider errors and treats rejected deliveries as failure", async () => {
  m.verify.mockRejectedValueOnce(new Error("fixture-secret"));
  await expect(verifySmtp("fixture-secret")).rejects.toThrow("smtp-connection-failed");
  m.send.mockResolvedValueOnce({ accepted: [], rejected: ["buyer@example.com"] });
  await expect(sendTransactionalMail({ to: "buyer@example.com", subject: "Тема", text: "Текст" })).rejects.toThrow("smtp-send-failed");
  expect(m.close).toHaveBeenCalledTimes(2);
});

