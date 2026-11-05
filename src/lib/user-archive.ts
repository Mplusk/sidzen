import type { PrismaClient } from "@prisma/client";

export type UserArchiveResult = "archived" | "restored" | "missing" | "forbidden" | "self" | "last-superadmin";

/** Uses the same lock as role removal and privacy erasure. */
export async function setUserArchived(db: PrismaClient, input: { actorId: string; userId: string; archive: boolean }): Promise<UserArchiveResult> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412042)`;
    const actor = await tx.user.findFirst({ where: { id: input.actorId, isActive: true, roles: { some: { role: { OR: [{ code: "superadmin" }, { permissions: { some: { permission: { code: "users.write" } } } }] } } } }, select: { id: true } });
    if (!actor) return "forbidden";
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, isActive: true, roles: { select: { role: { select: { code: true } } } } } });
    if (!user) return "missing";
    if (input.actorId === input.userId && input.archive) return "self";
    if (input.archive && user.isActive && user.roles.some(({ role }) => role.code === "superadmin")) {
      const activeSuperadmins = await tx.user.count({ where: { isActive: true, roles: { some: { role: { code: "superadmin" } } } } });
      if (activeSuperadmins <= 1) return "last-superadmin";
    }
    const result = input.archive ? "archived" : "restored";
    if (user.isActive === !input.archive) return result;
    await tx.user.update({ where: { id: user.id }, data: { isActive: !input.archive } });
    // A session must not spring back to life when an archived user is restored.
    if (input.archive) await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: input.archive ? "user.archive" : "user.restore", entityType: "User", entityId: user.id, after: { isActive: !input.archive } } });
    return result;
  });
}

