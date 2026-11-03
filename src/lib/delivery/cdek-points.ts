import { z } from "zod";
import type { CdekDeliveryClient, CdekPackage } from "./cdek-client";

export const cdekPointSchema = z.object({ code: z.string().min(1).max(80), name: z.string().max(255), is_handout: z.boolean(), is_reception: z.boolean().optional(), status: z.string(), type: z.string(), work_time: z.string().nullish(), location: z.object({ city_code: z.number().int(), address_full: z.string().min(1).max(500), latitude: z.number().nullish(), longitude: z.number().nullish() }) });

/** CDEK may silently substitute a nearby office for an oversized parcel in
 * calculator requests; independently check the exact point for every size. */
export async function checkedCdekPoint(api: CdekDeliveryClient, code: string, cityCode: number, packages: CdekPackage[], role: "recipient" | "sender" = "recipient") {
  const unique = [...new Map(packages.map(value => [JSON.stringify(value), value])).values()];
  if (!unique.length || unique.length > 50) throw new Error("packages");
  await api.authorize();
  let selected: z.infer<typeof cdekPointSchema> | undefined;
  for (let index = 0; index < unique.length; index += 5) {
    const results = await Promise.all(unique.slice(index, index + 5).map(parcel => api.deliveryPoint(code, parcel)));
    for (const result of results) {
      const points = z.array(cdekPointSchema).max(10).parse(result);
      const found = points.find(p => p.code === code && (role === "sender" ? p.is_reception : p.is_handout) && p.status === "ACTIVE" && p.location.city_code === cityCode);
      if (!found) throw new Error("point");
      selected = found;
    }
  }
  return selected!;
}
