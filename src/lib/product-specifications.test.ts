import { describe, expect, it } from "vitest";
import { productSpecificationRows, type SpecificationProduct } from "./product-specifications";
import { translatedSpecifications } from "./format";
import { isAdminOnlySpecification } from "./product-specification-visibility";

const product: SpecificationProduct = { specifications: { "Материал": "PLA пластик", "Цвет товара": "черный", "Вес с упаковкой, г": "85" }, widthMm: null, depthMm: null, heightMm: null, weightGrams: null, technologies: [], materials: [], colors: [], stock: 0, madeToOrder: false, leadDays: 3 };
describe("customer-facing product specifications", () => {
  it.each(["ТНВЭД", "ТН ВЭД коды ЕАЭС", "Код ТН-ВЭД", "tn_ved_code", "TN VED", "ОКПД 2", "Код ОКПД2", "ОКПД-2", "OKPD 2", "okpd2Code", "ОКПД", "ТН\u200bВЭД", "ＯＫＰＤ２"])("hides administrative classification %s without mutating stored values", (label) => {
    const specifications = { [label]: "3924900009", "Материал": "PLA пластик" };
    expect(isAdminOnlySpecification(label)).toBe(true);
    expect(translatedSpecifications(specifications)).toEqual({ "Материал": "PLA пластик" });
    expect(productSpecificationRows({ ...product, specifications })).toEqual([["Материал", "PLA пластик"]]);
    expect(specifications[label]).toBe("3924900009");
  });
  it("keeps unrelated customer properties visible", () => {
    const specifications = { "Материал": "PLA", "Цвет": "розовый", "Страна производства": "Россия", "Вес с упаковкой, г": "120" };
    expect(translatedSpecifications(specifications)).toEqual(specifications);
    for (const label of Object.keys(specifications)) expect(isAdminOnlySpecification(label)).toBe(false);
  });
  it("does not invent dimensions, technology or a manufacturing date for an unavailable ready product", () => {
    expect(productSpecificationRows(product)).toEqual([["Материал", "PLA пластик"], ["Цвет", "черный"], ["Вес с упаковкой, г", "85"]]);
    expect(productSpecificationRows({ ...product, specifications: null, widthMm: 0, depthMm: "0", heightMm: null })).toEqual([]);
  });
  it("shows known measurements, formats decimals and avoids duplicate rows", () => {
    expect(Object.fromEntries(productSpecificationRows({ ...product, specifications: { technology: "FDM", dimensions: "old" }, technologies: [{ name: "SLA" }], widthMm: "80.5", depthMm: 30, heightMm: 120, weightGrams: "52.5", stock: 2 }))).toEqual({ "Технология": "SLA", "Габариты": "80,5 × 30 × 120 мм", "Вес": "52,5 г", "Отправка": "На следующий рабочий день" });
    expect(Object.fromEntries(productSpecificationRows({ ...product, specifications: null, widthMm: 80, depthMm: 0 }))).toEqual({ "Ширина": "80 мм" });
  });
  it("uses a production lead time only for products actually available to order", () => {
    expect(Object.fromEntries(productSpecificationRows({ ...product, madeToOrder: true }))["Срок изготовления"]).toBe("3–5 рабочих дней");
  });
  it("shows parcel measurements separately, without inventing bare-item dimensions or duplicate weight", () => {
    expect(Object.fromEntries(productSpecificationRows({ ...product, shippingWeightG: 85, shippingLengthMm: 190, shippingWidthMm: 55, shippingHeightMm: 70 }))).toEqual({ "Материал": "PLA пластик", "Цвет": "черный", "Вес с упаковкой, г": "85", "Габариты упаковки (Д × Ш × В)": "190 × 55 × 70 мм" });
  });
  it("hides unresolved old Ozon IDs, nulls, objects and empty rows, without hiding valid false/zero values", () => {
    expect(translatedSpecifications({ "Ozon · 85": "Нет бренда", " ": "blank", "Пусто": "", "Нет данных": null, "Объект": {}, "Число": 0, "Флаг": false, technology: "FDM" })).toEqual({ "Число": "0", "Флаг": "Нет", "Технология": "FDM" });
  });
});
