import { describe, expect, it } from "vitest";
import { ozonAttributesSchema } from "./ozon-attributes";
import { ozonMeasurements } from "./ozon-measurements";
import { canonicalSnapshot } from "./model";

const parcel = { depth: 190, width: 55, height: 70, dimension_unit: "mm", weight: 85, weight_unit: "g" };
const parse = (value: object) => ozonAttributesSchema.parse({ result: [{ id: 1, attributes: [], ...value }] }).result[0];
const attribute = (id: number, name: string, value: string) => ({ id, name, values: [{ value }] });
describe("Ozon measurement import", () => {
  it("imports the real Seller API parcel without pretending it is the bare product", () => {
    expect(ozonMeasurements(parse(parcel), new Map())).toEqual({ packaging: { shippingWeightG: 85, shippingLengthMm: 190, shippingWidthMm: 55, shippingHeightMm: 70 } });
  });
  it("converts kg/cm/in and rounds parcel size upward, never underdeclaring", () => {
    expect(ozonMeasurements(parse({ ...parcel, weight: 0.0851, weight_unit: "kg", depth: 19.01, width: 5.5, height: 7, dimension_unit: "cm" }), new Map()).packaging).toEqual({ shippingWeightG: 86, shippingLengthMm: 191, shippingWidthMm: 55, shippingHeightMm: 70 });
    expect(ozonMeasurements(parse({ ...parcel, depth: 1, width: 1, height: 1, dimension_unit: "in" }), new Map()).packaging?.shippingLengthMm).toBe(26);
  });
  it("rejects incomplete, zero, negative, oversized and unknown-unit parcels without clearing website data", () => {
    for (const invalid of [{ height: 0 }, { width: -1 }, { weight: null }, { depth: 10_001 }, { weight: 1_000_001 }, { dimension_unit: "unknown" }, { weight_unit: undefined }]) {
      expect(ozonMeasurements(parse({ ...parcel, ...invalid }), new Map()).packaging).toBeUndefined();
    }
    expect(() => parse({ ...parcel, weight: Infinity })).toThrow();
  });
  it("imports explicit bare-item attributes separately and excludes packaging/sales counts", () => {
    const item = parse({ ...parcel, attributes: [attribute(10, "Высота товара, см", "6,5"), attribute(11, "Ширина, мм", "45"), attribute(12, "Длина предмета, см", "17"), attribute(13, "Вес товара без упаковки, кг", "0.065"), attribute(4497, "Вес с упаковкой, г", "85"), attribute(8513, "Количество в упаковке, шт", "1")] });
    expect(ozonMeasurements(item, new Map())).toMatchObject({ heightMm: 65, widthMm: 45, depthMm: 170, weightGrams: 65, packaging: { shippingWeightG: 85 } });
  });
  it("uses dictionary labels, ignores text/dimension bundles and does not guess units", () => {
    const item = parse({ attributes: [attribute(10, "Wrong name", "6.5"), attribute(11, "Габариты товара, см", "17 × 4.5 × 6.5"), attribute(12, "Вес", "65"), attribute(13, "Вес, г", "85 г")] });
    expect(ozonMeasurements(item, new Map([[10, "Высота, см"]]))).toEqual({ heightMm: 65 });
  });
  it("does not use ambiguous measurements, even if later attributes repeat a value", () => {
    const item = parse({ attributes: [attribute(1, "Длина, см", "17"), attribute(2, "Глубина, см", "20"), attribute(3, "Длина товара, см", "17")] });
    expect(ozonMeasurements(item, new Map()).depthMm).toBeUndefined();
  });
  it("keeps package source coherent and source priority independent of sync order", () => {
    const base = { sku: "ITEM", name: "Fixture", barcodes: [], price: 1, oldPrice: null, description: null, specifications: null, images: [], issue: null };
    const ozon = { provider: "ozon", externalId: "1", conflict: null, snapshot: { ...base, externalId: "1", measurements: ozonMeasurements(parse(parcel), new Map()) } };
    const wb = { provider: "wb", externalId: "2", conflict: null, snapshot: { ...base, externalId: "2", measurements: { weightGrams: 65, packaging: { shippingWeightG: 100, shippingLengthMm: 200, shippingWidthMm: 100, shippingHeightMm: 80 } } } };
    expect(canonicalSnapshot([ozon, wb], "ozon")).toEqual(canonicalSnapshot([wb, ozon], "ozon"));
    expect(canonicalSnapshot([wb, ozon], "ozon")?.measurements).toMatchObject({ weightGrams: 65, packaging: { shippingWeightG: 85, shippingWidthMm: 55 } });
    expect(canonicalSnapshot([wb, ozon], "wb")?.measurements?.packaging?.shippingWeightG).toBe(100);
  });
});
