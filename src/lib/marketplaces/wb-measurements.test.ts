import { describe, expect, it } from "vitest";
import { wbMeasurements, type WbDictionary } from "./wb-measurements";
import { fetchPage } from "./api";

const dictionary: WbDictionary = new Map([[1, { name: "Ширина предмета", unit: "см" }], [2, { name: "Высота предмета", unit: "см" }], [3, { name: "Вес товара без упаковки (г)", unit: "г" }]]);
const characteristics = [{ id: 1, name: "Ширина предмета", value: 18 }, { id: 2, name: "Высота предмета", value: 4.5 }, { id: 3, name: "Вес товара без упаковки (г)", value: 120 }];
const dimensions = { length: 19, width: 19, height: 6, weightBrutto: 0.185, isValid: true };
describe("WB item and package measurements", () => {
  it("imports actual WB bowl fields, resolving dictionary units and separating gross/net", () => {
    expect(wbMeasurements(dimensions, characteristics, dictionary)).toEqual({ widthMm: 180, heightMm: 45, weightGrams: 120, packaging: { shippingLengthMm: 190, shippingWidthMm: 190, shippingHeightMm: 60, shippingWeightG: 185 } });
  });
  it("does not guess missing item units, missing depth or use packaging for item measurements", () => {
    expect(wbMeasurements(dimensions, [], dictionary)).toEqual({ packaging: { shippingLengthMm: 190, shippingWidthMm: 190, shippingHeightMm: 60, shippingWeightG: 185 } });
    expect(wbMeasurements(null, characteristics.slice(0, 2), new Map())).toEqual({});
  });
  it("rejects invalid/incomplete parcels, unknown units, ranges and conflicting values", () => {
    expect(wbMeasurements({ ...dimensions, isValid: false }, [], dictionary)).toEqual({});
    expect(wbMeasurements({ ...dimensions, weightBrutto: 0 }, [], dictionary)).toEqual({});
    expect(wbMeasurements(null, [{ id: 1, name: "Ширина предмета", value: [18, 19] }], dictionary)).toEqual({});
    expect(wbMeasurements(null, [{ name: "Ширина предмета, мм", id: 1, value: 18 }, { name: "Ширина предмета, см", value: 20 }], new Map([[1, { name: "Ширина предмета, мм", unit: "см" }]]))).toEqual({ widthMm: 200 });
    expect(wbMeasurements(null, [{ name: "Длина предмета, см", value: 18 }, { name: "Глубина предмета, см", value: 19 }, { name: "Длина кабеля, см", value: 150 }], new Map())).toEqual({});
  });
  it("rounds parcel sizes up and keeps accurate item decimals", () => {
    const result = wbMeasurements({ length: 19.01, width: 19, height: 6, weightBrutto: 0.18501 }, [{ name: "Высота предмета, см", value: "4,55" }], new Map());
    expect(result.packaging?.shippingLengthMm).toBe(191); expect(result.packaging?.shippingWeightG).toBe(186); expect(result.heightMm).toBe(45.5);
  });
  it("fetches one subject dictionary per run across pages and includes units in specifications", async () => {
    const urls: string[] = [];
    const connection = { accountId: "fixture", clientId: "", name: "fixture", secret: "fixture", checkedAt: "fixture" };
    const transport: typeof fetch = async url => {
      urls.push(String(url));
      return Response.json(String(url).includes("/object/charcs/") ? { error: false, data: [...dictionary].map(([charcID, item]) => ({ charcID, name: item.name, unitName: item.unit })) } : { cards: [{ nmID: 11, subjectID: 5712, vendorCode: "fixture", title: "Bowl", dimensions, characteristics }], cursor: { total: 1 } });
    };
    const prices = new Map([["11", { nmID: "11", currencyIsoCode4217: "RUB", sizes: [{ price: 599, discountedPrice: 599 }] }]]), cache = new Map();
    for (let index = 0; index < 2; index++) {
      const page = await fetchPage("wb", connection, {}, transport, prices, undefined, cache);
      expect(page.items[0].measurements?.widthMm).toBe(180);
      expect(page.items[0].specifications?.["Высота предмета, см"]).toBe("4.5");
    }
    expect(urls.filter(url => url.includes("/object/charcs/"))).toHaveLength(1);
  });
});
