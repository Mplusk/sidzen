import { describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ remove: vi.fn(), sessions: vi.fn(), attempts: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "fixture-session" }), getAll: () => [{ name: "3dp_order_first" }, { name: "3dp_order_second" }, { name: "3dp_oauth_yandex", value: "fixture-oauth" }, { name: "unrelated" }], delete: m.remove }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { oAuthAttempt: { deleteMany: m.attempts }, session: { deleteMany: m.sessions } } }));
import { destroySession } from "./auth";
describe("logout personal-data isolation", () => {
  it("revokes session and all guest order grants, preserving unrelated cookies", async () => {
    await destroySession();
    expect(m.sessions).toHaveBeenCalledOnce();
    expect(m.remove.mock.calls.map(call => call[0])).toEqual(["3dp_session", "3dp_oauth_yandex", "3dp_order_first", "3dp_order_second"]);
    expect(m.attempts).toHaveBeenCalledOnce(); expect(JSON.stringify(m.attempts.mock.calls)).not.toContain("fixture-oauth");
  });
});
