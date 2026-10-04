import type { Snapshot } from "./model";
import type { OzonAttributes, OzonAttributeLabels } from "./ozon-attributes";

type Measurements = NonNullable<Snapshot["measurements"]>;
const lengthUnits: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, "мм": 1, "см": 10, "м": 1000 };
const weightUnits: Record<string, number> = { g: 1, kg: 1000, "г": 1, "кг": 1000 };
function convert(value: number | null | undefined, unit: string | null | undefined, units: Record<string, number>, maximum: number, integer = false) {
  const factor = unit ? units[unit.trim().toLowerCase()] : undefined;
  if (!factor || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const result = integer ? Math.ceil(value * factor) : Math.round(value * factor * 1000) / 1000;
  return result > 0 && result <= maximum ? result : undefined;
}

export function ozonMeasurements(item: OzonAttributes, labels: OzonAttributeLabels): Measurements {
  const result: Measurements = {};
  const conflicts = new Set<keyof Measurements>();
  const shippingWeightG = convert(item.weight, item.weight_unit, weightUnits, 1_000_000, true);
  const shippingLengthMm = convert(item.depth, item.dimension_unit, lengthUnits, 10_000, true);
  const shippingWidthMm = convert(item.width, item.dimension_unit, lengthUnits, 10_000, true);
  const shippingHeightMm = convert(item.height, item.dimension_unit, lengthUnits, 10_000, true);
  if (shippingWeightG && shippingLengthMm && shippingWidthMm && shippingHeightMm) {
    result.packaging = { shippingWeightG, shippingLengthMm, shippingWidthMm, shippingHeightMm };
  }
  // Use category dictionary names, not magic IDs: attribute IDs differ by type.
  // Only unambiguous scalar measurements with explicit units are imported.
  for (const attribute of item.attributes) {
    const label = (labels.get(attribute.id) ?? attribute.name ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
    const match = label.match(/^(вес|высота|ширина|длина|глубина)(?: (?:товара|изделия|предмета))?(?: без упаковки)?\s*,\s*(г|кг|мм|см|м)$/);
    if (!match || attribute.values.length !== 1) continue;
    const raw = attribute.values[0].value.trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(raw)) continue;
    const value = Number(raw.replace(",", "."));
    const weight = match[1] === "вес";
    const normalized = convert(value, match[2], weight ? weightUnits : lengthUnits, weight ? 1_000_000 : 10_000);
    if (!normalized) continue;
    const key = ({ вес: "weightGrams", высота: "heightMm", ширина: "widthMm", длина: "depthMm", глубина: "depthMm" } as const)[match[1] as "вес" | "высота" | "ширина" | "длина" | "глубина"];
    // Conflicting length/depth values require a human decision, not last-wins.
    if (conflicts.has(key)) continue;
    if (Object.hasOwn(result, key) && result[key] !== normalized) { delete result[key]; conflicts.add(key); continue; }
    result[key] = normalized;
  }
  return result;
}
