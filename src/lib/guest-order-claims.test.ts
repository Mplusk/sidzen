import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { claimGrantedGuestOrders } from "./guest-order-claims";
import { guestOrderSignature } from "./guest-order-grant";

describe("claiming a guest order", () => {
  it("revokes all grants and blocks the legacy signature when ownership is assigned", async () => {
    vi.stubEnv("AUTH_SECRET", "test-only");
    const order = { id: "id", number: "3DP-TEST", userId: null, createdAt: new Date(), personalDataErasedAt: null };
    const tx = {
      $executeRaw: vi.fn(),
      user: { findFirst: vi.fn().mockResolvedValue({ id: "buyer" }) },
      order: { findMany: vi.fn().mockResolvedValue([order]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      guestOrderGrant: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), upsert: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
    expect(await claimGrantedGuestOrders(db, "buyer", [{ name: `3dp_order_${order.number}`, value: guestOrderSignature(order.number) }])).toBe(1);
    expect(tx.guestOrderGrant.updateMany).toHaveBeenCalledOnce();
    expect(tx.guestOrderGrant.upsert).toHaveBeenCalledOnce();
  });
});
