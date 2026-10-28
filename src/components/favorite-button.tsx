"use client";
import { HeartIcon } from "./icons";
import { useShoppingState } from "./shopping-state";
export function FavoriteButton({ productId, name }: { productId: string; name: string }) {
  const { ids, pending, toggle } = useShoppingState(), selected = ids.includes(productId);
  return <button type="button" className="favorite-button" aria-label={`${selected ? "Убрать из избранного" : "Добавить в избранное"}: ${name}`} aria-pressed={selected} aria-busy={pending} disabled={pending} onClick={() => toggle(productId, !selected)}><HeartIcon aria-hidden="true" /></button>;
}
