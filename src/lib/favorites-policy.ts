export const FAVORITES_COOKIE = "sidzen_favorites";
export const MAX_FAVORITES = 50;
export function favoriteIds(value: string | undefined) {
  if (!value || value.length > 3300) return [];
  return [...new Set(value.split(".").filter(id => /^[a-zA-Z0-9_-]{1,64}$/.test(id)))].slice(0, MAX_FAVORITES);
}
export function selectFavorite(ids: string[], id: string, selected: boolean) {
  return selected ? [...new Set([...ids, id])] : ids.filter(value => value !== id);
}
