import { isAdminOnlySpecification } from "./product-specification-visibility";

export function formatPrice(value: number | string | { toString(): string }) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function pluralRu(value: number, forms: [string, string, string]) {
  const count = Math.abs(value) % 100;
  return forms[count > 10 && count < 20 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2];
}

export function translatedSpecifications(value: unknown) {
  const labels: Record<string, string> = { layer: "Высота слоя", tolerance: "Допуск", weight: "Вес", dimensions: "Габариты", material: "Материал", color: "Цвет", technology: "Технология", infill: "Заполнение", "Цвет товара": "Цвет" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (isAdminOnlySpecification(key) || /^Ozon\s*[·.]\s*\d+$/i.test(key) || !key.trim() || item == null || typeof item === "object") return [];
    const text = typeof item === "boolean" ? item ? "Да" : "Нет" : String(item).trim();
    return text ? [[labels[key] ?? key.trim(), text]] : [];
  }));
}

export function slugify(value: string) {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return value
    .toLowerCase()
    .split("")
    .map((letter) => translit[letter] ?? letter)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-{2,}/g, "-");
}
