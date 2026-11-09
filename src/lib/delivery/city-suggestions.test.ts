import { describe, expect, it, vi } from "vitest";
import { cityIndex, cityNames, rankCities } from "./city-suggestions";

describe("city typo suggestions", () => {
  const names = ["Тамбов", "Тамов", "Омск", "Москва", "Санкт-Петербург", "Яблоновский"];
  it("suggests omitted and transposed characters without replacing the user's input", () => {
    expect(rankCities("Тамов", names).slice(0, 2)).toEqual(["Тамов", "Тамбов"]);
    expect(rankCities("тамбв", names)).toContain("Тамбов");
    expect(rankCities("Табмов", names)).toContain("Тамбов");
    expect(rankCities("Санкт-Петербур", names)).toContain("Санкт-Петербург");
  });
  it("prefers exact prefixes, normalizes case and ё, and does not fuzzy-match short input", () => {
    expect(rankCities("МОС", names)).toEqual(["Москва"]);
    expect(rankCities("Ом", names)).toEqual(["Омск"]);
    expect(rankCities("ел", ["Ёлкино", "Ельня"])).toEqual(["Ёлкино", "Ельня"].sort((a,b) => a.localeCompare(b, "ru")));
    expect(rankCities("??", names)).toEqual([]);
  });
  it("extracts and deduplicates locality names from public carrier addresses", () => {
    expect(cityNames([{ address: "Россия, Тамбов, улица Ленина, 2" }, { address: "Россия, Тамбов, улица Пушкина, 7" }, { address: "Россия, Омская область, Омск, улица Ленина, 1" }])).toEqual(["Тамбов", "Омск"]);
  });
  it("shares concurrent index creation and reloads on directory change", async () => {
    const load = vi.fn().mockResolvedValue([{ address: "Россия, Тамбов, улица Ленина, 1" }]);
    const [first, second] = await Promise.all([cityIndex("test-one", load), cityIndex("test-one", load)]);
    expect(first).toEqual(["Тамбов"]); expect(second).toEqual(first); expect(load).toHaveBeenCalledTimes(1);
    await cityIndex("test-two", load); expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache a failed index build", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce([]);
    await expect(cityIndex("test-failure", load)).rejects.toThrow();
    await expect(cityIndex("test-failure", load)).resolves.toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
