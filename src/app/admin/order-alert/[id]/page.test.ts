import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: m.find } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import OrderAlert from "./page";
beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "staff" }); });
const open = (id = "opaque-order-id") => OrderAlert({ params: Promise.resolve({ id }) });
it("preserves the exact alert path for login and authorizes before any order lookup", async () => {
  m.permission.mockRejectedValue(new Error("login"));
  await expect(open()).rejects.toThrow("login");
  expect(m.permission).toHaveBeenCalledWith("orders.read", "/admin/order-alert/opaque-order-id/");
  expect(m.find).not.toHaveBeenCalled();
});
it("requires order-reading permission, even with a known order ID", async () => {
  m.permission.mockRejectedValue(new Error("forbidden"));
  await expect(open()).rejects.toThrow("forbidden"); expect(m.find).not.toHaveBeenCalled();
});
it("does not open missing, deleted or invalid orders", async () => {
  m.find.mockResolvedValue(null);
  await expect(open()).rejects.toThrow("404");
  expect(m.find).toHaveBeenCalledWith({ where: { id: "opaque-order-id", deletedAt: null }, select: { number: true } });
  m.find.mockClear(); await expect(open("invalid/id")).rejects.toThrow("404"); expect(m.find).not.toHaveBeenCalled();
});
it("opens the matching order without disclosing buyer data in the alert URL", async () => {
  m.find.mockResolvedValue({ number: "SIDZEN-123" });
  await expect(open()).rejects.toThrow("redirect:/admin/orders/SIDZEN-123/");
});
