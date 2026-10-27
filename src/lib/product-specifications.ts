import { pluralRu, translatedSpecifications } from "./format";

type Measurement = number | string | { toString(): string } | null;
export type SpecificationProduct = {
  specifications: unknown;
  widthMm: Measurement; depthMm: Measurement; heightMm: Measurement; weightGrams: Measurement;
  shippingWeightG?: number | null; shippingLengthMm?: number | null; shippingWidthMm?: number | null; shippingHeightMm?: number | null;
  materials: { name: string }[]; colors: { name: string }[];
  stock: number; madeToOrder: boolean; leadDays: number;
};
export function productSpecificationRows(product: SpecificationProduct) {
  const rows = new Map<string, string>();
  const number = (value: string) => Number(value.trim().replace(",", "."));
  const formatted = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
  for (const [rawKey, rawValue] of Object.entries(translatedSpecifications(product.specifications))) {
    let key = rawKey, value = rawValue;
    const label = rawKey.toLocaleLowerCase("ru");
    // Bare-item and packaged measurements are different facts. Never merge them.
    if (!/упаков/.test(label) || /без упаковки/.test(label)) {
      const dimension = /^(высота|ширина|глубина|длина)(?:\s+(?:предмета|товара|изделия))?(?:\s*[,()]\s*(?:см|мм|м)\)?)?$/i.exec(label);
      if (dimension) {
        key = ({ высота: "Высота", ширина: "Ширина", глубина: "Глубина", длина: "Длина" } as Record<string, string>)[dimension[1]];
        const quantity = /^\s*(\d+(?:[.,]\d+)?)\s*(мм|см|м)?\s*$/.exec(rawValue);
        if (quantity) {
          const unit = quantity[2] ?? (/(?:[,()]\s*)см/.test(label) ? "см" : /(?:[,()]\s*)м\)?$/.test(label) ? "м" : "мм");
          value = `${formatted(number(quantity[1]) * (unit === "см" ? 10 : unit === "м" ? 1000 : 1))} мм`;
        }
      }
      if (/^(вес|вес товара без упаковки|вес изделия|масса)(?:\s*[,()]\s*(?:г|кг)\)?)?$/.test(label)) {
        key = "Вес";
        const quantity = /^\s*(\d+(?:[.,]\d+)?)\s*(г|кг)?\s*$/.exec(rawValue);
        if (quantity) value = `${formatted(number(quantity[1]) * ((quantity[2] ?? (/кг/.test(label) ? "кг" : "г")) === "кг" ? 1000 : 1))} г`;
      }
    }
    if (/^материал(?: изделия| товара)?$/i.test(rawKey)) key = "Материал";
    if (/^цвет(?: изделия| товара)?$/i.test(rawKey)) key = "Цвет";
    rows.set(key, value);
  }
  for (const [label, options] of [["Материал", product.materials], ["Цвет", product.colors]] as const) {
    const text = [...new Set(options.map(option => option.name.trim()).filter(Boolean))].join(", ");
    if (text) rows.set(label, text);
  }
  const positive = (value: Measurement) => value != null && Number.isFinite(Number(value)) && Number(value) > 0;
  const format = (value: Measurement) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Number(value));
  const dimensions = [product.widthMm, product.depthMm, product.heightMm];
  if (dimensions.every(positive)) { for (const label of ["Ширина", "Глубина", "Высота"]) rows.delete(label); rows.set("Габариты", `${dimensions.map(format).join(" × ")} мм`); }
  else dimensions.forEach((value, index) => { if (positive(value)) rows.set(["Ширина", "Глубина", "Высота"][index], `${format(value)} мм`); });
  if (positive(product.weightGrams)) rows.set("Вес", `${format(product.weightGrams)} г`);
  if (positive(product.shippingWeightG ?? null)) rows.set("Вес с упаковкой, г", format(product.shippingWeightG!));
  const parcel = [product.shippingLengthMm ?? null, product.shippingWidthMm ?? null, product.shippingHeightMm ?? null];
  if (parcel.every(positive)) rows.set("Габариты упаковки (Д × Ш × В)", `${parcel.map(format).join(" × ")} мм`);
  if (product.stock > 0) rows.set("Отправка", "На следующий рабочий день");
  else if (product.madeToOrder) rows.set("Срок изготовления", `${product.leadDays}–${product.leadDays + 2} ${pluralRu(product.leadDays + 2, ["рабочий день", "рабочих дня", "рабочих дней"])}`);
  return [...rows.entries()];
}
