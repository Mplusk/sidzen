import { expect, it } from "vitest";
import { favoriteIds, selectFavorite, MAX_FAVORITES } from "./favorites-policy";

it("accepts only bounded public product IDs and removes duplicates", () => {
  expect(favoriteIds(undefined)).toEqual([]);
  expect(favoriteIds("first.first.<script>.second/../../.third")).toEqual(["first", "third"]);
  expect(favoriteIds("a".repeat(3301))).toEqual([]);
  expect(favoriteIds(Array.from({ length: 60 }, (_, i) => `product-${i}`).join("."))).toHaveLength(MAX_FAVORITES);
});

it("sets the desired state idempotently rather than toggling twice on a retry", () => {
  const initial = ["first", "second"];
  expect(selectFavorite(initial, "first", true)).toEqual(initial);
  expect(selectFavorite(initial, "third", true)).toEqual(["first", "second", "third"]);
  expect(selectFavorite(initial, "first", false)).toEqual(["second"]);
  expect(selectFavorite(["second"], "first", false)).toEqual(["second"]);
  expect(initial).toEqual(["first", "second"]);
});
