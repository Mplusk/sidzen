import { describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ remove: vi.fn(), sessions: vi.fn(), attempts: vi.fn(), revoke: vi.fn(), cookies: vi.fn(), lock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "fixture-session" }), getAll: m.cookies, delete: m.remove }) }));
vi.mock("@/lib/guest-order-grant", () => ({ revokeGuestGrant: m.revoke }));
vi.mock("@/lib/prisma", () => ({ prisma: { oAuthAttempt: { deleteMany: m.attempts }, session: { deleteMany: m.sessions }, $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: m.lock }) } }));
import { destroySession } from "./auth";
describe("logout personal-data isolation", () => {
  it("revokes session and all guest order grants, preserving unrelated cookies", async () => {
    m.cookies.mockReturnValue([{ name: "3dp_order_first" }, { name: "3dp_order_second" }, { name: "3dp_oauth_yandex", value: "fixture-oauth" }, { name: "unrelated" }]);
    await destroySession();
    expect(m.sessions).toHaveBeenCalledOnce();
    expect(m.remove.mock.calls.map(call => call[0])).toEqual(["3dp_session", "3dp_oauth_yandex", "3dp_order_first", "3dp_order_second"]);
    expect(m.attempts).toHaveBeenCalledOnce(); expect(JSON.stringify(m.attempts.mock.calls)).not.toContain("fixture-oauth");
  });
  it("revokes every guest grant even when more than 100 cookies exist", async () => {
    m.revoke.mockClear(); m.remove.mockClear();
    m.cookies.mockReturnValue(Array.from({ length: 105 }, (_, index) => ({ name: `3dp_order_3DP-QA-${index}`, value: `token-${index}` })));
    await destroySession();
    expect(m.revoke).toHaveBeenCalledTimes(105);
    expect(m.revoke.mock.calls.at(-1)?.[1]).toBe("3DP-QA-104");
  });
});
