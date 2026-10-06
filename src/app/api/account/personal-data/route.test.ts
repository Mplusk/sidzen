import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), orders: vi.fn(), consents: vi.fn(), requests: vi.fn(), social: vi.fn(), reviews: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { review: { findMany: m.reviews }, socialAccount: { findMany: m.social }, user: { findUnique: m.profile }, order: { findMany: m.orders }, privacyConsent: { findMany: m.consents }, privacyRequest: { findMany: m.requests } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
import { GET } from "./route";
describe("private data export", () => {
  beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "owner" }); m.profile.mockResolvedValue({ email: "owner@example.test" }); m.orders.mockResolvedValue([]); m.consents.mockResolvedValue([]); m.requests.mockResolvedValue([]); });
  it("denies anonymous access before any database lookup", async () => {
    m.user.mockResolvedValue(null); expect((await GET()).status).toBe(401); expect(m.profile).not.toHaveBeenCalled();
  });
  it("scopes every query to current user and explicitly excludes auth and staff secrets", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-disposition")).toContain("attachment");
    for (const query of [m.orders, m.consents, m.requests, m.social, m.reviews]) expect(query.mock.calls[0][0].where).toEqual({ userId: "owner" });
    const selections = JSON.stringify([m.profile.mock.calls, m.orders.mock.calls, m.consents.mock.calls]);
    for (const forbidden of ["passwordHash", "tokenHash", "internalNote", "subjectHash", "ozonJob"]) expect(selections).not.toContain(forbidden);
    expect(await response.json()).toMatchObject({ profile: { email: "owner@example.test" } });
  });
});
