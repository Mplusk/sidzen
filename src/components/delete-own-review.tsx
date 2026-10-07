"use client";
import { deleteOwnReviewAction } from "@/app/actions/reviews";
import { ConfirmAction } from "@/components/confirm-action";
export function DeleteOwnReview({ id }: { id: string }) {
  return <ConfirmAction action={deleteOwnReviewAction} title="Удалить отзыв?" description="Отзыв и все его фотографии будут удалены. Публикация и согласие будут прекращены. Действие нельзя отменить." trigger="Удалить отзыв" confirmLabel="Да, удалить отзыв">
    <input type="hidden" name="reviewId" value={id} /><input type="hidden" name="confirmation" value="delete-review" />
  </ConfirmAction>;
}
