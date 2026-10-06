import { z } from "zod";
import { ozonMeasurements } from "./ozon-measurements";

export const wbDimensionsSchema = z.object({
  length: z.number().nullish(), width: z.number().nullish(), height: z.number().nullish(),
  weightBrutto: z.number().nullish(), isValid: z.boolean().optional(),
});
export const wbCharacteristicSchema = z.object({
  id: z.number().int().positive().optional(), name: z.string(),
  value: z.union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()]),
});
export const wbDictionarySchema = z.object({ error: z.boolean().optional(), data: z.array(z.object({
  charcID: z.number().int().positive(), name: z.string(), unitName: z.string().nullish(),
})) });
export type WbDictionary = Map<number, { name: string; unit: string }>;
export type WbAttributeCache = Map<string, WbDictionary>;
type Characteristic = z.infer<typeof wbCharacteristicSchema>;

export function wbCharacteristicLabel(item: Characteristic, dictionary: WbDictionary) {
  const entry = item.id ? dictionary.get(item.id) : undefined;
  const name = entry?.name || item.name;
  return entry?.unit && !/[,()]\s*(г|кг|мм|см|м)\s*\)?$/i.test(name.trim()) ? `${name}, ${entry.unit}` : name;
}

export function wbMeasurements(dimensions: z.infer<typeof wbDimensionsSchema> | null | undefined, characteristics: Characteristic[], dictionary: WbDictionary) {
  // WB dimensions describe the packaged unit: cm and kg, not item mm and g.
  // Resolve item units from the subject dictionary, never guess from a value.
  const attributes = characteristics.flatMap((item, index) => {
    const label = wbCharacteristicLabel(item, dictionary).replace(/\s*\((г|кг|мм|см|м)\)\s*$/i, ", $1");
    const entry = item.id ? dictionary.get(item.id) : undefined;
    const explicit = label.match(/,\s*(г|кг|мм|см|м)$/i)?.[1];
    if (explicit && entry?.unit && explicit.toLowerCase() !== entry.unit.trim().toLowerCase()) return [];
    return [{ id: index, name: label, values: (Array.isArray(item.value) ? item.value : [item.value]).map(value => ({ value: String(value) })) }];
  });
  return ozonMeasurements({ id: "wb", attributes,
    ...(dimensions?.isValid !== false ? { depth: dimensions?.length, width: dimensions?.width, height: dimensions?.height, dimension_unit: "cm", weight: dimensions?.weightBrutto, weight_unit: "kg" } : {}),
  }, new Map());
}
