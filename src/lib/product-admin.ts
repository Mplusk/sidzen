import { z } from "zod";

export const PRODUCT_STATUSES = ["DRAFT", "REVIEW", "PUBLISHED", "HIDDEN", "ARCHIVED"] as const;
export const PRODUCT_TYPES = ["READY", "PARAMETRIC"] as const;
export const ROBOTS_VALUES = ["index,follow", "noindex,follow", "noindex,nofollow"] as const;
export const MAX_PRODUCT_IMAGES = 20;

const optionalNumber = (maximum: number) => z.preprocess(
  (value) => value === "" || value == null ? undefined : Number(value),
  z.number().finite().min(0).max(maximum).optional(),
);

const productSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(3).max(180),
  slug: z.string().trim().max(200),
  sku: z.string().trim().min(2).max(80),
  type: z.enum(PRODUCT_TYPES),
  status: z.enum(PRODUCT_STATUSES),
  badge: z.string().trim().max(80),
  shortDescription: z.string().trim().max(500),
  description: z.string().trim().max(20_000),
  usage: z.string().trim().max(5_000),
  instructions: z.string().trim().max(5_000),
  basePrice: z.coerce.number().finite().min(0).max(999_999_999),
  oldPrice: optionalNumber(999_999_999),
  costPrice: optionalNumber(999_999_999),
  stock: z.coerce.number().int().min(0).max(10_000_000),
  madeToOrder: z.boolean(),
  leadDays: z.coerce.number().int().min(1).max(3650),
  weightGrams: optionalNumber(10_000_000),
  widthMm: optionalNumber(1_000_000),
  depthMm: optionalNumber(1_000_000),
  heightMm: optionalNumber(1_000_000),
  modelAsset: z.string().trim().max(500),
  title: z.string().trim().max(180),
  h1: z.string().trim().max(180),
  metaDescription: z.string().trim().max(500),
  canonical: z.string().trim().max(500),
  robots: z.enum(ROBOTS_VALUES),
  publishedAt: z.string().trim().max(40),
  primaryCategoryId: z.string().trim().min(1),
  categoryIds: z.array(z.string().trim().min(1)).max(100),
  materialIds: z.array(z.string().trim().min(1)).max(100),
  colorIds: z.array(z.string().trim().min(1)).max(100),
  technologyIds: z.array(z.string().trim().min(1)).max(100),
  qualityProfileIds: z.array(z.string().trim().min(1)).max(100),
  postProcessIds: z.array(z.string().trim().min(1)).max(100),
  specificationsText: z.string().trim().max(30_000),
  imagesText: z.string().trim().max(30_000),
  imageLayout: z.string().max(30_000),
});

export type ProductGalleryEntry = {
  path: string;
  alt: string;
  caption?: string;
  sortOrder: number;
};

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function selectedValues(formData: FormData, name: string) {
  return [...new Set(formData.getAll(name).map(String).map((value) => value.trim()).filter(Boolean))];
}

export function parseSpecifications(value: string) {
  if (!value.trim()) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("specifications");
  return parsed as Record<string, unknown>;
}

export function parseGallery(value: string, fallbackAlt: string): ProductGalleryEntry[] {
  if (!value.trim()) return [];
  const entries = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (entries.length > MAX_PRODUCT_IMAGES) throw new Error("images");

  return entries.map((line, sortOrder) => {
    const [rawPath, rawAlt, ...captionParts] = line.split("|");
    const path = rawPath.trim();
    const alt = (rawAlt ?? "").trim() || fallbackAlt;
    const caption = captionParts.join("|").trim();
    if (!/^\/[a-zA-Z0-9._/-]+$/.test(path) || path.startsWith("//") || path.includes("..") || alt.length > 250 || caption.length > 500) {
      throw new Error("images");
    }
    return { path, alt, caption: caption || undefined, sortOrder };
  });
}

export function assertImageCapacity(existingCount: number, addedCount: number) {
  if (existingCount + addedCount > MAX_PRODUCT_IMAGES) throw new Error("images");
}

export function arrangeProductImages<T extends ProductGalleryEntry>(images: T[], value: string): T[] {
  if (!value) return images;
  const layout = z.array(z.object({ index: z.number().int().min(0), alt: z.string().trim().max(250), caption: z.string().trim().max(500) })).max(MAX_PRODUCT_IMAGES).parse(JSON.parse(value));
  if (layout.length !== images.length || new Set(layout.map((entry) => entry.index)).size !== images.length || layout.some((entry) => entry.index >= images.length)) throw new Error("images");
  return layout.map((entry, sortOrder) => ({ ...images[entry.index], alt: entry.alt || images[entry.index].alt, caption: entry.caption || undefined, sortOrder }));
}

export function storedProductImageName(path: string) {
  const match = /^\/uploads\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|avif))$/i.exec(path);
  return match?.[1] ?? null;
}

// Imported content-addressed files are also served, but are retained while
// marketplace snapshots can still refer to them (not ordinary editor uploads).
export function servedProductImageName(path: string) {
  return storedProductImageName(path) ?? /^\/uploads\/products\/(mp-[0-9a-f]{64}\.(?:jpg|png|webp|avif))$/.exec(path)?.[1] ?? null;
}

export function serializeGallery(entries: Array<{ path: string; alt: string; caption?: string | null }>) {
  return entries.map((entry) => [entry.path, entry.alt, ...(entry.caption ? [entry.caption] : [])].join(" | ")).join("\n");
}

export function parseProductForm(formData: FormData) {
  const result = productSchema.safeParse({
    id: stringValue(formData, "id") || undefined,
    name: stringValue(formData, "name"),
    slug: stringValue(formData, "slug"),
    sku: stringValue(formData, "sku"),
    type: stringValue(formData, "type") || "READY",
    status: stringValue(formData, "status") || "DRAFT",
    badge: stringValue(formData, "badge"),
    shortDescription: stringValue(formData, "shortDescription"),
    description: stringValue(formData, "description"),
    usage: stringValue(formData, "usage"),
    instructions: stringValue(formData, "instructions"),
    basePrice: formData.get("basePrice"),
    oldPrice: formData.get("oldPrice"),
    costPrice: formData.get("costPrice"),
    stock: formData.get("stock"),
    madeToOrder: formData.get("madeToOrder") === "on",
    leadDays: formData.get("leadDays"),
    weightGrams: formData.get("weightGrams"),
    widthMm: formData.get("widthMm"),
    depthMm: formData.get("depthMm"),
    heightMm: formData.get("heightMm"),
    modelAsset: stringValue(formData, "modelAsset"),
    title: stringValue(formData, "title"),
    h1: stringValue(formData, "h1"),
    metaDescription: stringValue(formData, "metaDescription"),
    canonical: stringValue(formData, "canonical"),
    robots: stringValue(formData, "robots") || "index,follow",
    publishedAt: stringValue(formData, "publishedAt"),
    primaryCategoryId: stringValue(formData, "primaryCategoryId"),
    categoryIds: selectedValues(formData, "categoryIds"),
    materialIds: selectedValues(formData, "materialIds"),
    colorIds: selectedValues(formData, "colorIds"),
    technologyIds: selectedValues(formData, "technologyIds"),
    qualityProfileIds: selectedValues(formData, "qualityProfileIds"),
    postProcessIds: selectedValues(formData, "postProcessIds"),
    specificationsText: stringValue(formData, "specificationsText"),
    imagesText: stringValue(formData, "imagesText"),
    imageLayout: stringValue(formData, "imageLayout"),
  });
  if (!result.success) return { success: false as const, error: "invalid" };

  try {
    const data = result.data;
    return {
      success: true as const,
      data: {
        ...data,
        categoryIds: [...new Set([data.primaryCategoryId, ...data.categoryIds])],
        specifications: parseSpecifications(data.specificationsText),
        images: parseGallery(data.imagesText, `${data.name}, изделие 3D-печати`),
      },
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "invalid" };
  }
}
