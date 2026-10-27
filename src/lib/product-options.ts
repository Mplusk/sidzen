export type ProductOptions = {
  id: string; name: string; basePrice: number; weightGrams: number; stock: number; madeToOrder: boolean;
  materials: Array<{ id: string; slug: string; name: string; pricePerGram: number }>;
  colors: Array<{ id: string; slug: string; name: string; hex: string }>;
  variants: Array<{ id: string; materialId: string | null; colorId: string | null; qualityProfileId: string | null; price: number }>;
};
export type ProductSelection = { material: string; color: string; quantity: number };

const optionOrder = (a: { slug: string; id: string }, b: { slug: string; id: string }) => a.slug.localeCompare(b.slug, "ru") || a.id.localeCompare(b.id);
export function defaultSelection(product: ProductOptions): ProductSelection {
  return {
    material: [...product.materials].sort((a, b) => a.pricePerGram - b.pricePerGram || optionOrder(a, b))[0]?.slug ?? "",
    color: [...product.colors].sort((a, b) => a.name.localeCompare(b.name, "ru") || optionOrder(a, b))[0]?.slug ?? "",
    quantity: 1,
  };
}

// Public listings quote exactly the configuration initially selected on the
// product page. Keep variant overrides and rounding in
// priceProduct, rather than maintaining a second pricing formula.
export function defaultProductPrice(product: ProductOptions): number {
  return priceProduct(product, defaultSelection(product)).unitPrice;
}

export function priceProduct(product: ProductOptions, selection: ProductSelection) {
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 999) throw new Error("quantity");
  const material = product.materials.find((item) => item.slug === selection.material);
  const color = product.colors.find((item) => item.slug === selection.color);
  if ((product.materials.length ? !material : selection.material) || (product.colors.length ? !color : selection.color)) throw new Error("options");
  // Legacy quality-specific variants must not silently choose a retired price.
  const variant = product.variants.find((item) => item.qualityProfileId == null && item.materialId === (material?.id ?? null) && item.colorId === (color?.id ?? null));
  const referenceMaterialPrice = Math.min(...product.materials.map((item) => item.pricePerGram));
  const materialAdjustment = material && referenceMaterialPrice >= 0 ? product.weightGrams > 0
    ? product.weightGrams * (material.pricePerGram - referenceMaterialPrice)
    : referenceMaterialPrice > 0 ? product.basePrice * (material.pricePerGram / referenceMaterialPrice - 1) : 0 : 0;
  const unitPrice = variant ? variant.price : Math.ceil(product.basePrice + materialAdjustment);
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice * selection.quantity > 999_999_999) throw new Error("price");
  return {
    unitPrice, total: Math.round(unitPrice * selection.quantity * 100) / 100, variantId: variant?.id,
    materialId: material?.id, colorId: color?.id,
    config: { material: material?.slug ?? "", materialName: material?.name ?? "", color: color?.slug ?? "", colorName: color?.name ?? "" },
  };
}

export function configurationText(value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback: Record<string, string> = { pla: "PLA", petg: "PETG", abs: "ABS", nylon: "Nylon", graphite: "Графит", cobalt: "Кобальт", forest: "Лесной", "signal-orange": "Оранжевый", "warm-white": "Тёплый белый" };
  return [["materialName", "material"], ["colorName", "color"]].map(([name, key]) => typeof config[name] === "string" && config[name] ? config[name] : typeof config[key] === "string" ? fallback[config[key] as string] ?? config[key] : "").filter(Boolean).join(" · ");
}
