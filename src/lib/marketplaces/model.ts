import { z } from "zod";

export const providers = ["ozon", "wb"] as const;
export type Provider = typeof providers[number];
export const snapshotSchema = z.object({
  externalId: z.string().min(1).max(100),
  sku: z.string().trim().min(2).max(80),
  barcodes: z.array(z.string().min(1).max(100)).max(200),
  name: z.string().trim().min(3).max(180),
  description: z.string().max(20_000).nullable(),
  specifications: z.record(z.string(), z.string()).nullable(),
  price: z.number().finite().positive().max(999_999_999),
  oldPrice: z.number().finite().positive().max(999_999_999).nullable(),
  images: z.array(z.string().max(1000)).max(20),
  // An item-level issue prevents automatic mutation, even if already linked.
  issue: z.string().nullable().default(null),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const normalizeSku = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
export const normalizeBarcode = (value: string) => value.normalize("NFKC").trim();
export function identityKeys(snapshot: Pick<Snapshot, "sku" | "barcodes">) {
  return [...new Set([`sku:${normalizeSku(snapshot.sku)}`, ...snapshot.barcodes.map(normalizeBarcode).filter(Boolean).map((value) => `barcode:${value}`)])];
}

export const policySchema = z.object({ primary: z.enum(providers).default("ozon"), categoryId: z.string().default("") });
export type Policy = z.infer<typeof policySchema>;
export const POLICY_KEY = "integrations.marketplace.policy";
export const connectionKey = (provider: Provider) => `integrations.marketplace.${provider}`;
export const connectionSchema = z.object({ accountId: z.string(), clientId: z.string().default(""), name: z.string().max(200), secret: z.string(), checkedAt: z.string() });
export type Connection = z.infer<typeof connectionSchema>;

// A stable primary source, rather than "last import wins". A missing optional
// field falls back to the other source. Local publication/manufacturing stay local.
export function canonicalSnapshot(rows: { provider: string; externalId: string; snapshot: unknown; conflict: string | null }[], primary: Provider) {
  const candidates = rows.filter((row) => !row.conflict).sort((a, b) =>
    Number(b.provider === primary) - Number(a.provider === primary) || a.provider.localeCompare(b.provider) || a.externalId.localeCompare(b.externalId),
  ).map((row) => snapshotSchema.safeParse(row.snapshot)).filter((row) => row.success).map((row) => row.data!).filter((row) => !row.issue);
  const first = candidates[0];
  if (!first) return null;
  return { ...first,
    description: candidates.find((row) => row.description)?.description ?? null,
    specifications: candidates.find((row) => row.specifications && Object.keys(row.specifications).length)?.specifications ?? null,
    images: candidates.find((row) => row.images.length)?.images ?? [],
  };
}

export const conflictMessages: Record<string, string> = {
  identifiers: "Артикул и штрихкоды указывают на разные товары.",
  ambiguous: "Найдено несколько подходящих карточек.",
  variant: "Артикул занят вариантом товара. Требуется ручное сопоставление.",
  name: "Есть карточка с таким названием, но идентификаторы отличаются. Проверьте совпадение.",
  sku: "Артикул уже занят или отсутствует. Требуется проверка.",
  prices: "У размеров разные цены. Настройте цену и варианты на сайте вручную.",
  currency: "Цена не в рублях или отсутствует.",
  images: "Не удалось безопасно загрузить фотографии. Повторите синхронизацию.",
  multiple: "К этому товару уже привязана другая карточка этого маркетплейса.",
  data: "Карточка не соответствует формату: проверьте название, артикул и цену.",
};
export const runErrors: Record<string, string> = {
  credentials: "Нет подключения или изменился кабинет продавца.",
  auth: "API отклонил ключ. Проверьте срок действия и права токена.",
  rate: "Маркетплейс ограничил запросы. Повторите позже.",
  remote: "API маркетплейса недоступен. Уже обработанные карточки сохранены; повторный запуск безопасен.",
  format: "API вернул неожиданный формат. Импорт остановлен без пропуска страницы.",
  database: "Обработка прервана. Уже обработанные карточки сохранены; повторный запуск безопасен.",
};
