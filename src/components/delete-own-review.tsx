"use client";
import { useFormStatus } from "react-dom";
import { deleteOwnReviewAction } from "@/app/actions/reviews";
function DeleteButton() { const { pending } = useFormStatus(); return <button className="button button--outline button--small" disabled={pending} type="submit">{pending ? "Удаляем…" : "Удалить отзыв"}</button>; }
export function DeleteOwnReview({ id }: { id: string }) {
  return <form action={deleteOwnReviewAction} onSubmit={event => { if (!window.confirm("Удалить отзыв и все его фотографии? Публикация и согласие будут прекращены.")) event.preventDefault(); }}>
    <input type="hidden" name="reviewId" value={id} /><input type="hidden" name="confirmation" value="delete-review" /><DeleteButton />
  </form>;
}
