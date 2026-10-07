"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { catalogOptionInUse, parseCatalogCreate, parseCatalogDelete, type CatalogKind } from "@/lib/catalog-admin";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { categoryNameKey } from "@/lib/category-ai/client";

class CatalogActionError extends Error {
  constructor(readonly code: "missing" | "inuse" | "duplicate") {
    super(code);
  }
}

function catalogErrorCode(error: unknown, operation: "create" | "delete") {
  if (error instanceof CatalogActionError) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "duplicate";
    if (error.code === "P2003" || error.code === "P2014") return operation === "delete" ? "inuse" : "invalid";
    if (error.code === "P2025") return "missing";
    if (error.code === "P2034") return "conflict";
  }
  return "invalid";
}

function refreshCatalogPages() {
  revalidatePath("/admin/catalog/");
  revalidatePath("/admin/products/new/");
  updateTag("catalog");
  revalidatePath("/catalog/");
  revalidatePath("/materials/");
  revalidatePath("/technologies/");
}

export async function createCatalogOptionAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = parseCatalogCreate(formData);
  if (!parsed.success) redirect("/admin/catalog/?error=invalid");
  const data = parsed.data;

  let created: { id: string; name: string; slug: string };
  let entityType: string;
  try {
    switch (data.kind) {
      case "category":
        created = await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
          if ((await tx.category.findMany({ select: { name: true, parentId: true } })).some(item => item.parentId === (data.parentId || null) && categoryNameKey(item.name) === categoryNameKey(data.name))) throw new CatalogActionError("duplicate");
          return tx.category.create({ data: {
            name: data.name, slug: data.slug, description: data.description || null,
            title: data.name, h1: data.name, metaDescription: data.description || null,
            parentId: data.parentId || null,
          } });
        });
        entityType = "Category";
        break;
      case "material":
        created = await prisma.material.create({ data: {
          name: data.name, slug: data.slug, description: data.description || null,
          type: data.type, density: data.density, pricePerGram: data.pricePerGram,
          colors: { connect: (await prisma.color.findMany({ where: { active: true }, select: { id: true } })).map(({ id }) => ({ id })) },
        } });
        entityType = "Material";
        break;
      case "color":
        created = await prisma.color.create({ data: {
          name: data.name, slug: data.slug, hex: data.hex.toLowerCase(),
          materials: { connect: (await prisma.material.findMany({ where: { active: true }, select: { id: true } })).map(({ id }) => ({ id })) },
        } });
        entityType = "Color";
        break;
      case "technology":
        created = await prisma.technology.create({ data: {
          name: data.name, slug: data.slug, description: data.description || null,
          accuracy: data.accuracy || null, applications: data.applications || null,
        } });
        entityType = "Technology";
        break;
      case "quality":
        created = await prisma.qualityProfile.create({ data: {
          name: data.name, slug: data.slug, description: data.description || null,
          layerHeightMm: data.layerHeightMm, speedMultiplier: data.speedMultiplier,
          priceMultiplier: data.priceMultiplier,
        } });
        entityType = "QualityProfile";
        break;
      case "postProcess":
        created = await prisma.postProcessOption.create({ data: {
          name: data.name, slug: data.slug, description: data.description || null,
          price: data.price, leadDays: data.leadDays,
        } });
        entityType = "PostProcessOption";
        break;
    }
  } catch (error) {
    redirect(`/admin/catalog/?error=${catalogErrorCode(error, "create")}`);
  }

  await writeAudit({ actorId: user.id, action: `${data.kind}.create`, entityType, entityId: created.id, after: { name: created.name, slug: created.slug } });
  refreshCatalogPages();
  redirect(`/admin/catalog/?saved=${data.kind}#${data.kind}`);
}

async function deleteUnusedOption(kind: CatalogKind, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    switch (kind) {
      case "category": {
        const item = await tx.category.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true, children: true, seoFilters: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.category.delete({ where: { id } });
        return { entityType: "Category", name: item.name, slug: item.slug };
      }
      case "material": {
        const item = await tx.material.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true, variants: true, orderItems: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.material.delete({ where: { id } });
        return { entityType: "Material", name: item.name, slug: item.slug };
      }
      case "color": {
        const item = await tx.color.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true, variants: true, orderItems: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.color.delete({ where: { id } });
        return { entityType: "Color", name: item.name, slug: item.slug };
      }
      case "technology": {
        const item = await tx.technology.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true, orderItems: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.technology.delete({ where: { id } });
        return { entityType: "Technology", name: item.name, slug: item.slug };
      }
      case "quality": {
        const item = await tx.qualityProfile.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true, variants: true, orderItems: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.qualityProfile.delete({ where: { id } });
        return { entityType: "QualityProfile", name: item.name, slug: item.slug };
      }
      case "postProcess": {
        const item = await tx.postProcessOption.findUnique({ where: { id }, select: { id: true, name: true, slug: true, _count: { select: { products: true } } } });
        if (!item) throw new CatalogActionError("missing");
        if (catalogOptionInUse(item._count)) throw new CatalogActionError("inuse");
        await tx.postProcessOption.delete({ where: { id } });
        return { entityType: "PostProcessOption", name: item.name, slug: item.slug };
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteCatalogOptionAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = parseCatalogDelete(formData);
  if (!parsed.success) redirect("/admin/catalog/?error=invalid");

  let deleted: Awaited<ReturnType<typeof deleteUnusedOption>>;
  try {
    deleted = await deleteUnusedOption(parsed.data.kind, parsed.data.id);
  } catch (error) {
    redirect(`/admin/catalog/?error=${catalogErrorCode(error, "delete")}`);
  }

  await writeAudit({ actorId: user.id, action: `${parsed.data.kind}.delete`, entityType: deleted.entityType, entityId: parsed.data.id, before: { name: deleted.name, slug: deleted.slug } });
  refreshCatalogPages();
  redirect(`/admin/catalog/?deleted=${parsed.data.kind}#${parsed.data.kind}`);
}
