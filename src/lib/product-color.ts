/** Color on an imported product card, when the selected product is itself a variant. */
export function productColorFromSpecifications(specifications: unknown): string | null {
  if (!specifications || typeof specifications !== "object" || Array.isArray(specifications)) return null;
  for (const [key, value] of Object.entries(specifications)) {
    if (!/^(?:цвет(?:\s+(?:товара|изделия|основной))?|основной\s+цвет)$/iu.test(key.trim())) continue;
    const text = typeof value === "string" ? value : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
    if (text.trim()) return text.trim().slice(0, 180);
  }
  return null;
}
