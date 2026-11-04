import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { removeUserRole } from "./user-role-removal";

const input = { actorId: "actor", userId: "target", roleId: "role", ip: "127.0.0.1" };
const tx = {
  $executeRaw: vi.fn(),
  user: { findFirst: vi.fn(), count: vi.fn() },
  userRole: { findUnique: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn() },
};
const db = { $transaction: vi.fn(async (callback) => callback(tx)) } as unknown as PrismaClient;

describe("removing user roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.user.findFirst.mockResolvedValue({ id: "actor" });
    tx.user.count.mockResolvedValue(2);
    tx.userRole.findUnique.mockResolvedValue({ role: { code: "admin" }, user: { isActive: true } });
    tx.userRole.findFirst.mockResolvedValue({ roleId: "other" });
  });

  it("rejects a caller whose management access has been revoked", async () => {
    tx.user.findFirst.mockResolvedValue(null);
    expect(await removeUserRole(db, input)).toBe("forbidden");
    expect(tx.userRole.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not remove the last active superadmin", async () => {
    tx.userRole.findUnique.mockResolvedValue({ role: { code: "superadmin" }, user: { isActive: true } });
    tx.user.count.mockResolvedValue(1);
    expect(await removeUserRole(db, input)).toBe("last-superadmin");
    expect(tx.userRole.delete).not.toHaveBeenCalled();
  });

  it("prevents removing one's own last management role", async () => {
    tx.userRole.findFirst.mockResolvedValue(null);
    expect(await removeUserRole(db, { ...input, userId: "actor" })).toBe("own-access");
    expect(tx.userRole.delete).not.toHaveBeenCalled();
  });

  it("handles a role that was already removed", async () => {
    tx.userRole.findUnique.mockResolvedValue(null);
    expect(await removeUserRole(db, input)).toBe("missing");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("removes the selected assignment and records the actor and role", async () => {
    expect(await removeUserRole(db, input)).toBe("removed");
    expect(tx.userRole.delete).toHaveBeenCalledWith({ where: { userId_roleId: { userId: "target", roleId: "role" } } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: "actor", action: "user.role.remove", entityType: "User", entityId: "target", before: { roleId: "role", roleCode: "admin" }, ip: "127.0.0.1" } });
  });
});

