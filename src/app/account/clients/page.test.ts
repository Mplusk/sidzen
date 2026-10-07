import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ permission: vi.fn(), count: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { count: m.count, findMany: m.find } } }));
import ClientsPage, { metadata } from "./page";

describe("private registered clients directory", () => {
  beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({}); m.count.mockResolvedValue(151); m.find.mockResolvedValue([]); });
  it("checks customers.read before querying any personal data", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    await expect(ClientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("forbidden");
    expect(m.permission).toHaveBeenCalledWith("customers.read");
    expect(m.count).not.toHaveBeenCalled(); expect(m.find).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it("paginates every account with stable ordering and only necessary fields", async () => {
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(m.find).toHaveBeenCalledWith({ select: { id: true, name: true, phone: true, email: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 100, take: 50 });
    expect(html).toContain("Страница 3 из 4"); expect(html).toContain("?page=4");
  });
  it("normalizes invalid and out-of-range page requests", async () => {
    for (const page of ["Infinity", "NaN", "-20", ["1", "2"]]) {
      await ClientsPage({ searchParams: Promise.resolve({ page }) }); expect(m.find.mock.lastCall![0].skip).toBe(0);
    }
    await ClientsPage({ searchParams: Promise.resolve({ page: "999999" }) }); expect(m.find.mock.lastCall![0].skip).toBe(150);
  });
  it("shows missing profile fields honestly, escapes names, and links email/phone", async () => {
    m.count.mockResolvedValue(2); m.find.mockResolvedValue([
      { id: "1", name: "<script>QA</script>", phone: "+7 (999) 123-45-67", email: "qa@example.test", createdAt: new Date("2026-01-01Z") },
      { id: "2", name: null, phone: null, email: "social@example.test", createdAt: new Date("2026-01-01Z") },
    ]);
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Не указан"); expect(html).toContain('href="tel:+79991234567"'); expect(html).toContain('href="mailto:qa@example.test"');
  });
});
