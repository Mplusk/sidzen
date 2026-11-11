import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueTelegramCancellation, queueTelegramLatePayment } from "./status";

const m = vi.hoisted(() => ({ original: vi.fn(), updateOriginal: vi.fn(), find: vi.fn(), upsert: vi.fn(), update: vi.fn() }));
const tx = { $executeRaw: vi.fn(), telegramOrderJob: { findUnique: m.original, updateMany: m.updateOriginal }, telegramOrderStatusJob: { findUnique: m.find, upsert: m.upsert, updateMany: m.update } } as unknown as Prisma.TransactionClient;
beforeEach(() => { vi.resetAllMocks(); m.original.mockResolvedValue({ revision: "qa" }); });

describe("Telegram order status outbox", () => {
  it("queues one cancellation and suppresses an unsent new-order message", async () => {
    await queueTelegramCancellation(tx, "order");
    expect(m.updateOriginal).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: "order", status: "PENDING" }, data: expect.objectContaining({ status: "CANCELED" }) }));
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId_kind: { orderId: "order", kind: "CANCELED" } }, update: {} }));
  });
  it("does not send cancellation messages for orders created without Telegram enabled", async () => {
    m.original.mockResolvedValue(null);
    await queueTelegramCancellation(tx, "order");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("suppresses an unsent cancellation and queues a correction for a later payment", async () => {
    m.find.mockResolvedValue({ id: "status", status: "PENDING", revision: "qa" });
    await queueTelegramLatePayment(tx, "order");
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "status", status: "PENDING" }, data: { status: "CANCELED" } }));
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { orderId: "order", kind: "LATE_PAYMENT", revision: "qa" } }));
  });
  it.each(["RUNNING", "SENT", "UNCERTAIN"])("queues a correction after cancellation state %s", async status => {
    m.find.mockResolvedValue({ id: "status", status, revision: "qa" });
    await queueTelegramLatePayment(tx, "order");
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { orderId: "order", kind: "LATE_PAYMENT", revision: "qa" } }));
  });
});
