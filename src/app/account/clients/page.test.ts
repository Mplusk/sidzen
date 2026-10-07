import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ permission: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/clients", () => ({ getClientsPage: m.list }));
import ClientsPage, { metadata } from "./page";

describe("private registered clients directory", () => {
  beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ roles: [], permissions: new Set() }); m.list.mockResolvedValue({ clients: [], total: 151, page: 3, pages: 4 }); });
  it("checks customers.read before querying any personal data", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    await expect(ClientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("forbidden");
    expect(m.permission).toHaveBeenCalledWith("customers.read");
    expect(m.list).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it("paginates every account with stable ordering and only necessary fields", async () => {
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(m.list).toHaveBeenCalledWith(3, false);
    expect(html).toContain("Страница 3 из 4"); expect(html).toContain("?page=4");
  });
  it("ignores ambiguous repeated page parameters", async () => {
    await ClientsPage({ searchParams: Promise.resolve({ page: ["1", "2"] }) }); expect(m.list).toHaveBeenCalledWith(1, false);
  });
  it("shows missing profile fields honestly, escapes names, and links email/phone", async () => {
    m.list.mockResolvedValue({ total: 2, page: 1, pages: 1, clients: [
      { id: "1", name: "<script>QA</script>", phone: "+7 (999) 123-45-67", email: "qa@example.test", createdAt: new Date("2026-01-01Z"), source: "ORDER" },
      { id: "2", name: null, phone: null, email: "social@example.test", createdAt: new Date("2026-01-01Z"), source: "ACCOUNT" },
    ] });
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Не указан"); expect(html).toContain('href="tel:+79991234567"'); expect(html).toContain('href="mailto:qa@example.test"');
    expect(html).toContain("Покупатель без регистрации");
  });
});
