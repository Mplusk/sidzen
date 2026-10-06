import Image from "next/image";
export type ReviewCardData = { id: string; author: string; text: string; rating: number; createdAt: Date; verifiedPurchase: boolean; images: Array<{ id: string; width: number; height: number }> };
export function ReviewCard({ review }: { review: ReviewCardData }) {
  return <article className="review-card">
    <header className="review-card__header"><strong>{review.author}</strong><time dateTime={review.createdAt.toISOString()}>{review.createdAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}</time></header>
    <div className="review-card__rating"><span className="review-rating" aria-label={`Оценка ${review.rating} из 5`}>{"★".repeat(review.rating)}<span className="muted">{"☆".repeat(5 - review.rating)}</span></span>{review.verifiedPurchase && <small className="review-verified">✓ Товар куплен</small>}</div>
    <p className="review-text">{review.text}</p>
    {!!review.images.length && <div className="review-photos">{review.images.map((image, index) => <a key={image.id} href={`/api/review-images/${image.id}/`} target="_blank" rel="noopener" aria-label={`Открыть фото товара ${index + 1}`}><Image unoptimized src={`/api/review-images/${image.id}/`} alt={`Фото купленного товара ${index + 1}`} width={88} height={88} loading="lazy" /></a>)}</div>}
  </article>;
}
