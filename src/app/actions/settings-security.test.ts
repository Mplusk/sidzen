import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ permission: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { siteSetting: { findUnique: m.find, updateMany: m.update } } }));
vi.mock("@/lib/audit", () => ({ writeAudit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { updateSettingAction } from "./admin";

function form(key: string, value: string) {
  const data = new FormData();
  data.set("key", key); data.set("value", value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.permission.mockResolvedValue({ id: "operator" });
  m.update.mockResolvedValue({ count: 1 });
});

it("rejects forged updates to security settings even from settings administrators", async () => {
  for (const setting of [
    { id: "a", group: "security", value: true, key: "security.admin_email_confirmation" },
    { id: "a", group: "general", value: true, key: "security.admin_email_confirmation" },
    { id: "b", group: "security", value: "old", key: "another_security_setting" },
  ]) {
    m.find.mockResolvedValueOnce(setting);
    await expect(updateSettingAction(form(setting.key, "false"))).rejects.toThrow("/admin/settings/?error=key");
  }
  expect(m.update).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});

it("updates ordinary settings while guarding against a concurrent group change", async () => {
  m.find.mockResolvedValue({ id: "a", group: "contacts", value: "old" });
  await updateSettingAction(form("contacts.email", "new@example.test"));
  expect(m.update).toHaveBeenCalledWith({ where: { key: "contacts.email", group: "contacts" }, data: { value: "new@example.test" } });
  m.update.mockResolvedValueOnce({ count: 0 });
  await expect(updateSettingAction(form("contacts.email", "new@example.test"))).rejects.toThrow("/admin/settings/?error=key");
  expect(m.audit).toHaveBeenCalledTimes(1);
});

