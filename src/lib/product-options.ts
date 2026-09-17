export type ProductOptions = {
  id: string; name: string; basePrice: number; weightGrams: number; stock: number; madeToOrder: boolean;
  materials: Array<{ id: string; slug: string; name: string; pricePerGram: number }>;
  colors: Array<{ id: string; slug: string; name: string; hex: string }>;
  qualities: Array<{ id: string; slug: string; name: string; layerHeightMm: number; priceMultiplier: number }>;
  variants: Array<{ id: string; materialId: string | null; colorId: string | null; qualityProfileId: string | null; price: number }>;
};
export type ProductSelection = { material: string; color: string; quality: string; quantity: number };

export function defaultSelection(product: ProductOptions): ProductSelection {
  return { material: [...product.materials].sort((a, b) => a.pricePerGram - b.pricePerGram)[0]?.slug ?? "", color: product.colors[0]?.slug ?? "", quality: (product.qualities.find((item) => item.slug === "standard") ?? product.qualities[0])?.slug ?? "", quantity: 1 };
}

export function priceProduct(product: ProductOptions, selection: ProductSelection) {
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 999) throw new Error("quantity");
  const material = product.materials.find((item) => item.slug === selection.material);
  const color = product.colors.find((item) => item.slug === selection.color);
  const quality = product.qualities.find((item) => item.slug === selection.quality);
  if ((product.materials.length ? !material : selection.material) || (product.colors.length ? !color : selection.color) || (product.qualities.length ? !quality : selection.quality)) throw new Error("options");
  const variant = product.variants.find((item) => item.materialId === (material?.id ?? null) && item.colorId === (color?.id ?? null) && item.qualityProfileId === (quality?.id ?? null));
  const referenceMaterialPrice = Math.min(...product.materials.map((item) => item.pricePerGram));
  const materialAdjustment = material && referenceMaterialPrice >= 0 ? product.weightGrams > 0
    ? product.weightGrams * (material.pricePerGram - referenceMaterialPrice)
    : referenceMaterialPrice > 0 ? product.basePrice * (material.pricePerGram / referenceMaterialPrice - 1) : 0 : 0;
  const unitPrice = variant ? variant.price : Math.ceil((product.basePrice + materialAdjustment) * (quality?.priceMultiplier ?? 1));
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice * selection.quantity > 999_999_999) throw new Error("price");
  return {
    unitPrice, total: Math.round(unitPrice * selection.quantity * 100) / 100, variantId: variant?.id,
    materialId: material?.id, colorId: color?.id, qualityProfileId: quality?.id,
    config: { material: material?.slug ?? "", materialName: material?.name ?? "", color: color?.slug ?? "", colorName: color?.name ?? "", quality: quality?.slug ?? "", qualityName: quality ? `${quality.name} · ${quality.layerHeightMm} мм` : "" },
  };
}

export function configurationText(value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback: Record<string, string> = { pla: "PLA", petg: "PETG", abs: "ABS", nylon: "Nylon", graphite: "Графит", cobalt: "Кобальт", forest: "Лесной", "signal-orange": "Оранжевый", "warm-white": "Тёплый белый", draft: "Черновое", standard: "Стандартное", fine: "Высокое" };
  return [["materialName", "material"], ["colorName", "color"], ["qualityName", "quality"]].map(([name, key]) => typeof config[name] === "string" && config[name] ? config[name] : typeof config[key] === "string" ? fallback[config[key] as string] ?? config[key] : "").filter(Boolean).join(" · ");
}
