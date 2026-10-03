import { describe, expect, it } from "vitest";
import { fetchOzonAttributes } from "./api";
import { ozonSpecifications, repairLegacyOzonSpecifications, type OzonAttributes } from "./ozon-attributes";
import type { Connection } from "./model";

const connection: Connection = { accountId: "1", clientId: "1", name: "Fixture", secret: "fixture-only", checkedAt: "2026-10-04" };
const labels = new Map([[6383, "Материал"], [10096, "Цвет товара"], [4497, "Вес с упаковкой, г"], [85, "Бренд"], [4180, "Название"], [23536, "Нужен код маркировки"], [22232, "ТН ВЭД коды ЕАЭС"]]);
const item: OzonAttributes = { id: "11", description_category_id: 17027907, type_id: 92404, attributes: [
  { id: 6383, values: [{ value: "PLA пластик" }] }, { id: 10096, values: [{ value: "черный" }] },
  { id: 4497, values: [{ value: "85" }] }, { id: 85, values: [{ value: "Нет бренда" }] },
  { id: 23536, values: [{ value: "false" }] }, { id: 22232, values: [{ value: "3924900009" }] },
  { id: 4180, values: [{ value: "Салфетница Вершина" }] }, { id: 9024, values: [{ value: "300030" }] },
] };
describe("real Ozon attribute structure", () => {
  it("resolves names from the category/type dictionary, cached across product pages", async () => {
    let calls = 0;
    const transport: typeof fetch = async (url, options) => {
      if (String(url).endsWith("/v4/product/info/attributes")) return Response.json({ result: [item] });
      expect(String(url)).toBe("https://api-seller.ozon.ru/v1/description-category/attribute");
      expect(JSON.parse(String(options?.body))).toEqual({ description_category_id: 17027907, type_id: 92404, language: "DEFAULT" });
      calls++;
      return Response.json({ result: [...labels].map(([id, name]) => ({ id, name })) });
    };
    const cache = new Map();
    for (let page = 0; page < 2; page++) {
      const source = (await fetchOzonAttributes(connection, ["11"], transport, cache)).get("11")!;
      expect(ozonSpecifications(source.item, source.labels)).toEqual({ "Материал": "PLA пластик", "Цвет товара": "черный", "Вес с упаковкой, г": "85" });
    }
    expect(calls).toBe(1);
  });
  it("fails explicitly rather than inventing numeric labels if category metadata is missing", async () => {
    await expect(fetchOzonAttributes(connection, ["11"], async () => Response.json({ result: [{ id: 11, attributes: item.attributes }] }))).rejects.toThrow("format");
  });
  it("repairs old keys without replacing manual named values or losing unknown data", () => {
    expect(repairLegacyOzonSpecifications({ "Ozon · 6383": "PLA пластик", "Ozon · 85": "Нет бренда", "Ozon · 10096": "черный", "Цвет товара": "белый", "Ручное поле": "сохранить", "Ozon · 777777": "неизвестно", "Ozon · 22232": "3924900009" }, labels)).toEqual({ changed: true, value: { "Материал": "PLA пластик", "Цвет товара": "белый", "Ручное поле": "сохранить", "Ozon · 777777": "неизвестно" } });
    expect(repairLegacyOzonSpecifications({ "Материал": "Дерево" }, labels)).toEqual({ changed: false, value: { "Материал": "Дерево" } });
  });
});
