import { describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), cart: vi.fn(), consent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { session: { deleteMany: m.session }, cart: { deleteMany: m.cart }, privacyConsent: { deleteMany: m.consent } } }));
import { pruneTransientPersonalData } from "./privacy-maintenance";
describe("limited personal-data retention", () => {
  it("only removes expired sessions, inactive guest carts and unlinked old quote receipts", async () => {
    await pruneTransientPersonalData(new Date("2026-10-04T12:00:00Z"));
    expect(m.session.mock.calls[0][0].where.expiresAt.lt).toEqual(new Date("2026-10-04T12:00:00Z"));
    expect(m.cart.mock.calls[0][0].where).toMatchObject({ userId: null, items: { none: { updatedAt: { gte: new Date("2026-09-04T12:00:00Z") } } } });
    expect(m.consent.mock.calls[0][0].where).toMatchObject({ purpose: "ozon", orderId: null, createdAt: { lt: new Date("2026-07-06T12:00:00Z") } });
  });
});
