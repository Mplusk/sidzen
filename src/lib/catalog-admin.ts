import { z } from "zod";
import { slugify } from "@/lib/format";

export const CATALOG_KINDS = ["category", "material", "color", "technology", "quality", "postProcess"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

const name = z.string().trim().min(2).max(180);
const slug = z.string().trim().max(200);
const description = z.string().trim().max(5_000);
const decimal = (minimum: number, maximum: number) => z.preprocess(
  (value) => value == null || value === "" ? Number.NaN : Number(value),
  z.number().finite().min(minimum).max(maximum),
);

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), name, slug, description, parentId: z.string().trim().max(100).optional() }),
  z.object({ kind: z.literal("material"), name, slug, description, type: z.string().trim().min(2).max(80), density: decimal(0.001, 100), pricePerGram: decimal(0, 999_999) }),
  z.object({ kind: z.literal("color"), name, slug, hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ kind: z.literal("technology"), name, slug, description, accuracy: z.string().trim().max(180), applications: z.string().trim().max(2_000) }),
  z.object({ kind: z.literal("quality"), name, slug, description, layerHeightMm: decimal(0.001, 10), speedMultiplier: decimal(0.001, 100), priceMultiplier: decimal(0.001, 100) }),
  z.object({ kind: z.literal("postProcess"), name, slug, description, price: decimal(0, 999_999), leadDays: decimal(0, 3_650).pipe(z.number().int()) }),
]);

const deleteSchema = z.object({ kind: z.enum(CATALOG_KINDS), id: z.string().trim().min(1).max(100) });

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

export function parseCatalogCreate(formData: FormData) {
  const result = createSchema.safeParse({
    kind: formText(formData, "kind"),
    name: formText(formData, "name"),
    slug: formText(formData, "slug"),
    description: formText(formData, "description"),
    parentId: formText(formData, "parentId") || undefined,
    type: formText(formData, "type"),
    density: formData.get("density"),
    pricePerGram: formData.get("pricePerGram"),
    hex: formText(formData, "hex"),
    accuracy: formText(formData, "accuracy"),
    applications: formText(formData, "applications"),
    layerHeightMm: formData.get("layerHeightMm"),
    speedMultiplier: formData.get("speedMultiplier"),
    priceMultiplier: formData.get("priceMultiplier"),
    price: formData.get("price"),
    leadDays: formData.get("leadDays"),
  });
  if (!result.success) return { success: false as const, error: "invalid" as const };

  const normalizedSlug = slugify(result.data.slug || result.data.name);
  if (!normalizedSlug || normalizedSlug.length > 200) return { success: false as const, error: "invalid" as const };
  return { success: true as const, data: { ...result.data, slug: normalizedSlug } };
}

export function parseCatalogDelete(formData: FormData) {
  const result = deleteSchema.safeParse({ kind: formText(formData, "kind"), id: formText(formData, "id") });
  return result.success ? { success: true as const, data: result.data } : { success: false as const, error: "invalid" as const };
}

export function catalogOptionInUse(counts: Record<string, number>) {
  return Object.values(counts).some((count) => count > 0);
}
