import type { PrismaClient } from "@prisma/client";

export type RoleRemovalResult = "removed" | "missing" | "forbidden" | "last-superadmin" | "own-access";

/** Serialize removals so concurrent requests cannot remove the last two superadmins. */
export async function removeUserRole(db: PrismaClient, input: { actorId: string; userId: string; roleId: string; ip?: string }): Promise<RoleRemovalResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412042)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412051)`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const actor = await tx.user.findFirst({ where: { id: input.actorId, isActive: true, roles: { some: { role: { OR: [{ code: "superadmin" }, { permissions: { some: { permission: { code: "users.write" } } } }] } } } }, select: { id: true } });
    if (!actor) return "forbidden";

    const assignment = await tx.userRole.findUnique({ where: { userId_roleId: { userId: input.userId, roleId: input.roleId } }, include: { role: true, user: { select: { isActive: true } } } });
    if (!assignment) return "missing";

    if (assignment.role.code === "superadmin" && assignment.user.isActive) {
      const activeSuperadmins = await tx.user.count({ where: { isActive: true, roles: { some: { role: { code: "superadmin" } } } } });
      if (activeSuperadmins <= 1) return "last-superadmin";
    }

    if (input.actorId === input.userId) {
      const remainingAccess = await tx.userRole.findFirst({ where: { userId: input.userId, roleId: { not: input.roleId }, role: { OR: [{ code: "superadmin" }, { permissions: { some: { permission: { code: "users.write" } } } }] } }, select: { roleId: true } });
      if (!remainingAccess) return "own-access";
    }

    await tx.userRole.delete({ where: { userId_roleId: { userId: input.userId, roleId: input.roleId } } });
    await tx.session.updateMany({ where: { userId: input.userId, adminVerifiedAt: { not: null } }, data: { adminVerifiedAt: null } });
    await tx.adminLoginChallenge.updateMany({ where: { userId: input.userId, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "user.role.remove", entityType: "User", entityId: input.userId, before: { roleId: input.roleId, roleCode: assignment.role.code }, ip: input.ip } });
    return "removed";
  });
}

