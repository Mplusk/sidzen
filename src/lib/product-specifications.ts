import { pluralRu, translatedSpecifications } from "./format";

type Measurement = number | string | { toString(): string } | null;
export type SpecificationProduct = {
  specifications: unknown;
  widthMm: Measurement; depthMm: Measurement; heightMm: Measurement; weightGrams: Measurement;
  shippingWeightG?: number | null; shippingLengthMm?: number | null; shippingWidthMm?: number | null; shippingHeightMm?: number | null;
  technologies: { name: string }[]; materials: { name: string }[]; colors: { name: string }[];
  stock: number; madeToOrder: boolean; leadDays: number;
};
export function productSpecificationRows(product: SpecificationProduct) {
  const rows = new Map(Object.entries(translatedSpecifications(product.specifications)));
  for (const [label, options] of [["Технология", product.technologies], ["Материал", product.materials], ["Цвет", product.colors]] as const) {
    const text = [...new Set(options.map(option => option.name.trim()).filter(Boolean))].join(", ");
    if (text) rows.set(label, text);
  }
  const positive = (value: Measurement) => value != null && Number.isFinite(Number(value)) && Number(value) > 0;
  const format = (value: Measurement) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Number(value));
  const dimensions = [product.widthMm, product.depthMm, product.heightMm];
  if (dimensions.every(positive)) rows.set("Габариты", `${dimensions.map(format).join(" × ")} мм`);
  else dimensions.forEach((value, index) => { if (positive(value)) rows.set(["Ширина", "Глубина", "Высота"][index], `${format(value)} мм`); });
  if (positive(product.weightGrams)) rows.set("Вес", `${format(product.weightGrams)} г`);
  if (positive(product.shippingWeightG ?? null)) rows.set("Вес с упаковкой, г", format(product.shippingWeightG!));
  const parcel = [product.shippingLengthMm ?? null, product.shippingWidthMm ?? null, product.shippingHeightMm ?? null];
  if (parcel.every(positive)) rows.set("Габариты упаковки (Д × Ш × В)", `${parcel.map(format).join(" × ")} мм`);
  if (product.stock > 0) rows.set("Отправка", "На следующий рабочий день");
  else if (product.madeToOrder) rows.set("Срок изготовления", `${product.leadDays}–${product.leadDays + 2} ${pluralRu(product.leadDays + 2, ["рабочий день", "рабочих дня", "рабочих дней"])}`);
  return [...rows.entries()];
}
