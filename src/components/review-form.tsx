"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createReviewAction } from "@/app/actions/reviews";
import { MAX_REVIEW_PHOTO_BYTES, MAX_REVIEW_PHOTOS } from "@/lib/reviews";

function SubmitReview() {
  const { pending } = useFormStatus();
  return <button className="button button--small" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Загружаем отзыв и фото…" : "Отправить отзыв"}</button>;
}
export function ReviewForm({ productId, allowAi = false }: { productId: string; allowAi?: boolean }) {
  const [rating, setRating] = useState(0), [previews, setPreviews] = useState<string[]>([]), [error, setError] = useState("");
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  return <form action={createReviewAction} className="review-form">
    <input type="hidden" name="productId" value={productId} />
    <fieldset className="review-stars"><legend>Ваша оценка *</legend>{[1, 2, 3, 4, 5].map(value => <label key={value}><input type="radio" name="rating" value={value} required checked={rating === value} onChange={() => setRating(value)} /><span className={value <= rating ? "is-filled" : ""} aria-hidden="true">★</span><span className="sr-only">{value} из 5</span></label>)}<span className="muted">{rating ? `${rating} из 5` : "Выберите оценку"}</span></fieldset>
    <label className="field">Публичное имя *<input name="author" required minLength={2} maxLength={40} placeholder="Например, Максим" autoComplete="off" /><small>Имя или псевдоним. Данные профиля и заказа не публикуются.</small></label>
    <label className="field">Отзыв о товаре *<textarea name="text" required minLength={10} maxLength={3000} rows={4} placeholder="Расскажите о качестве и использовании товара" /></label>
    <label className="field">Фото купленного товара<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => {
      const selected = Array.from(event.target.files ?? []);
      if (selected.length > MAX_REVIEW_PHOTOS || selected.some(file => file.size > MAX_REVIEW_PHOTO_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("Выберите до 5 фото JPG, PNG или WebP, каждое не больше 5 МБ."); event.target.value = ""; setPreviews([]); }
      else { setError(""); setPreviews(selected.map(file => URL.createObjectURL(file))); }
    }} /><small>До 5 фотографий, по 5 МБ. Только товар, без людей, адресов и других персональных данных.</small></label>
    {error && <p className="notice notice--danger" role="alert">{error}</p>}
    {!!previews.length && <div className="review-photos">{previews.map((url, index) => <Image src={url} unoptimized key={url} width={88} height={88} alt={`Выбранное фото ${index + 1}`} />)}</div>}
    <label className="checkbox-row"><input type="checkbox" name="consent" required /> <span>Даю отдельное <Link className="text-link" href="/legal/consent/?purpose=review" target="_blank" rel="noopener">согласие на публикацию имени, отзыва и фото</Link>. Не публикую чужие персональные данные.</span></label>
    {allowAi && <label className="checkbox-row"><input type="checkbox" name="aiConsent" /> <span>Разрешаю <Link className="text-link" href="/legal/consent/?purpose=review-ai" target="_blank" rel="noopener">проверить текст отзыва через DeepSeek</Link> (внешний сервис, Китай). Необязательно: без согласия проверит администратор.</span></label>}
    <small className="muted">{allowAi ? "Текст может проверить ИИ с вашего отдельного согласия; фотографии и спорные отзывы проверяет администратор." : "Отзыв и фотографии проверит администратор. Текст в DeepSeek не отправляется."} Оценка не влияет на решение о публикации. Статус и удаление доступны в «Мои отзывы».</small>
    <SubmitReview />
  </form>;
}
