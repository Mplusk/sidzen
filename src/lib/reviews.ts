import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const MAX_REVIEW_PHOTOS = 5;
export const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
export const REVIEW_CONSENT_VERSION = "2026-10-06-reviews-v1";
export const REVIEW_CONSENT_TEXT = "Я отдельно разрешаю оператору магазина 3DPRINTA публиковать на сайте 3dprinta.shop выбранное мной публичное имя, оценку, текст отзыва и приложенные фотографии для информирования покупателей. Эти сведения будут доступны неограниченному кругу посетителей, которые могут их копировать. Разрешаю распространение только на этом сайте; передачу для рекламы и размещение на других площадках не разрешаю. Телефон, email, адрес, сведения профиля и номер заказа публиковать не разрешаю. Не прикладываю изображения людей и чужие персональные данные. Согласие действует до отзыва. Отозвать его и прекратить публикацию можно кнопкой «Удалить отзыв» в разделе «Мои отзывы» либо через «Персональные данные» и по контактам оператора. Сайт прекратит доступ к отзыву и фото; копии, ранее сделанные посетителями, могут сохраниться.";

export const publicReviewWhere: Prisma.ReviewWhereInput = {
  approved: true,
  OR: [{ verifiedPurchase: false }, { consent: { is: { revokedAt: null } } }],
};

// Match a real account-owned, paid and delivered line item. Neither an email
// match, a guest cookie, nor a posted order/user ID grants this right.
export function purchasedProductWhere(userId: string, productId?: string): Prisma.OrderWhereInput {
  return { userId, status: "DELIVERED", payment: { is: { status: "PAID", refundReviewRequired: false } },
    ...(productId ? { items: { some: { productId, quantity: { gt: 0 } } } } : {}) };
}

const schema = z.object({
  productId: z.string().min(1).max(100),
  author: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} ._-]+$/u),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(10).max(3000),
  consent: z.literal("on"),
});
export function parseReview(form: FormData) {
  return schema.safeParse({ productId: form.get("productId"), author: form.get("author"), rating: form.get("rating"), text: form.get("text"), consent: form.get("consent") });
}
export function reviewPage(value: unknown, total: number, size = 10) {
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = typeof value === "string" && /^\d{1,8}$/.test(value) ? Number(value) : 1;
  return { page: Math.max(1, Math.min(pages, requested)), pages };
}
export const reviewStatusLabel = (status: string) => status === "PUBLISHED" ? "Опубликован" : status === "HIDDEN" ? "Не опубликован после проверки" : "На проверке";
