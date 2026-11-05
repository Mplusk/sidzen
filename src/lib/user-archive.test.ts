import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { setUserArchived } from "./user-archive";

const tx = { $executeRaw: vi.fn(), user: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn() }, session: { deleteMany: vi.fn() }, auditLog: { create: vi.fn() } };
const db = { $transaction: vi.fn(async callback => callback(tx)) } as unknown as PrismaClient;
const input = { actorId: "actor", userId: "target", archive: true };

describe("user archive", () => {
  beforeEach(() => { vi.clearAllMocks(); tx.user.findFirst.mockResolvedValue({ id: "actor" }); tx.user.findUnique.mockResolvedValue({ id: "target", isActive: true, roles: [] }); tx.user.count.mockResolvedValue(2); });
  it("blocks an actor whose management permission was revoked", async () => { tx.user.findFirst.mockResolvedValue(null); expect(await setUserArchived(db, input)).toBe("forbidden"); expect(tx.user.update).not.toHaveBeenCalled(); });
  it("prevents archiving the current user or the last active superadmin", async () => {
    expect(await setUserArchived(db, { ...input, userId: "actor" })).toBe("self");
    tx.user.findUnique.mockResolvedValue({ id: "target", isActive: true, roles: [{ role: { code: "superadmin" } }] }); tx.user.count.mockResolvedValue(1);
    expect(await setUserArchived(db, input)).toBe("last-superadmin"); expect(tx.user.update).not.toHaveBeenCalled();
  });
  it("archives an account, revokes sessions and records the operation", async () => {
    expect(await setUserArchived(db, input)).toBe("archived");
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "target" }, data: { isActive: false } });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "target" } });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("restores an archived account without reviving sessions", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "target", isActive: false, roles: [] });
    expect(await setUserArchived(db, { ...input, archive: false })).toBe("restored");
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "target" }, data: { isActive: true } });
    expect(tx.session.deleteMany).not.toHaveBeenCalled();
  });
});

