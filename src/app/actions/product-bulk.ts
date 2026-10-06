"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { bulkProductSchema, ProductBulkError, setProductsStatus } from "@/lib/product-bulk";

export type ProductBulkState = { success: boolean; message: string; skus?: string[] };
const messages: Record<string, string> = {
  busy: "Дождитесь завершения синхронизации маркетплейсов. Статусы не изменены.",
  missing: "Один из товаров удалён или недоступен для редактирования. Обновите список. Статусы не изменены.",
  permission: "Для изменения опубликованных товаров требуется право публикации. Статусы не изменены.",
  category: "Для публикации нужна видимая категория. Выберите её для товаров без категории или исправьте карточки. Статусы не изменены.",
};
export async function bulkProductStatusAction(_previous: ProductBulkState, form: FormData): Promise<ProductBulkState> {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const parsed = bulkProductSchema.safeParse({ productIds: form.getAll("productIds"), status: form.get("status"), categoryId: form.get("categoryId") ?? "" });
  if (!parsed.success) return { success: false, message: "Выберите от 1 до 500 товаров и корректный статус." };
  if (!rateLimit(`product-bulk:${user.id}`, 20, 60_000).allowed) return { success: false, message: "Слишком много изменений. Повторите через минуту." };
  const canPublish = user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin");
  let count: number;
  try { count = await setProductsStatus(parsed.data, { id: user.id, canPublish }); }
  catch (error) {
    return { success: false, message: error instanceof ProductBulkError ? messages[error.code] ?? "Не удалось изменить статусы. Изменения отменены." : "Не удалось изменить статусы. Изменения отменены.", ...(error instanceof ProductBulkError && error.skus.length ? { skus: error.skus.slice(0, 20) } : {}) };
  }
  updateTag("catalog"); revalidatePath("/catalog/", "layout"); revalidatePath("/admin/products/", "layout"); revalidatePath("/sitemap.xml");
  return { success: true, message: `Статус изменён у товаров: ${count}.` };
}
