import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ raw: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { getClientsPage } from "./clients";
describe("internal customer contact directory", () => {
  beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(fn => fn({ $queryRaw: m.raw })); m.raw.mockImplementation(sql => Promise.resolve(sql.text.includes("count(*)::int") ? [{ total: 151 }] : [])); });
  it("uses a consistent paginated read-only snapshot and explicit safe fields", async () => {
    expect(await getClientsPage(3)).toEqual({ total: 151, pages: 4, page: 3, clients: [] });
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    const sql = m.raw.mock.lastCall![0]; expect(sql.values.at(-1)).toBe(100);
    expect(sql.text).toContain('c."userId" IS NULL'); expect(sql.text).toContain('o."deletedAt" IS NULL');
    expect(sql.text).toContain("a.email_key = c.email_key AND a.phone_key = c.phone_key");
    for (const field of ["passwordHash", "twoFactorKey", "tokenHash", "internalNote", "UPDATE", "INSERT"]) expect(sql.text).not.toContain(field);
  });
  it("bounds invalid page numbers without limiting total client count", async () => {
    for (const input of [Infinity, NaN, -10, 0]) { expect((await getClientsPage(input)).page).toBe(1); expect(m.raw.mock.lastCall![0].values.at(-1)).toBe(0); }
    expect((await getClientsPage(999999)).page).toBe(4); expect(m.raw.mock.lastCall![0].values.at(-1)).toBe(150);
  });
});
