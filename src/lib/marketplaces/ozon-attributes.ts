import { z } from "zod";

export const ozonAttributesSchema = z.object({ result: z.array(z.object({
  id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)]).transform(String),
  description_category_id: z.number().int().positive().optional(),
  type_id: z.number().int().positive().optional(),
  // Seller API volume/weight fields describe the packaged sale unit.
  depth: z.number().nullish(), width: z.number().nullish(), height: z.number().nullish(),
  dimension_unit: z.string().nullish(), weight: z.number().nullish(), weight_unit: z.string().nullish(),
  attributes: z.array(z.object({ id: z.number().int(), name: z.string().optional(), values: z.array(z.object({ value: z.string() })) })).default([]),
})) });
export const ozonAttributeDictionarySchema = z.object({ result: z.array(z.object({ id: z.number().int(), name: z.string().trim().min(1) })) });
export type OzonAttributes = z.infer<typeof ozonAttributesSchema>["result"][number];
export type OzonAttributeLabels = Map<number, string>;
export type OzonAttributeCache = Map<string, OzonAttributeLabels>;

// Seller/category administration, not customer-facing product properties.
const technicalIds = new Set([4191, 4180, 9024, 9048, 22232, 23536]);
export function ozonSpecification(id: number, label: string | undefined, values: string[]) {
  if (technicalIds.has(id) || !label?.trim()) return null;
  const value = [...new Set(values.map(value => value.trim()).filter(Boolean))].join(", ");
  if (!value || (id === 85 && value.toLocaleLowerCase("ru-RU") === "нет бренда")) return null;
  return [label.trim(), value] as const;
}
export function ozonSpecifications(item: OzonAttributes, labels: OzonAttributeLabels) {
  const result: Record<string, string> = {};
  for (const attribute of item.attributes) {
    const pair = ozonSpecification(attribute.id, labels.get(attribute.id) ?? attribute.name, attribute.values.map(value => value.value));
    if (!pair) continue;
    result[pair[0]] = result[pair[0]] ? [...new Set([result[pair[0]], pair[1]])].join(", ") : pair[1];
  }
  return result;
}

// Repair only old importer-generated keys, keeping named/manual website fields
// and their values intact, including products protected by SITE mode.
export function repairLegacyOzonSpecifications(value: unknown, labels: OzonAttributeLabels) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, changed: false };
  const original = Object.entries(value);
  const result = Object.fromEntries(original.filter(([key]) => !/^Ozon\s*[·.]\s*\d+$/i.test(key)));
  let changed = false;
  for (const [key, item] of original) {
    const match = key.match(/^Ozon\s*[·.]\s*(\d+)$/i);
    if (!match) continue;
    const id = Number(match[1]);
    // Unknown legacy fields are retained in storage, never guessed or lost.
    if (!labels.has(id) && !technicalIds.has(id)) { result[key] = item; continue; }
    changed = true;
    const pair = ozonSpecification(id, labels.get(id), [String(item)]);
    if (pair && !Object.hasOwn(result, pair[0])) result[pair[0]] = pair[1];
  }
  return { value: result, changed };
}
