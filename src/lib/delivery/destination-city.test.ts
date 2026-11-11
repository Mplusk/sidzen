import { describe, expect, it } from "vitest";
import { destinationCity } from "./destination-city";

describe("delivery destination city", () => {
  it.each([
    ["Россия, Санкт-Петербург, улица Тестовая, 1", "ozon-delivery", "Санкт-Петербург"],
    ["Россия, Санкт-Петербург, Беговая улица, 3", "ozon-delivery", "Санкт-Петербург"],
    ["Россия, Санкт-Петербург г., Софийская улица, 44", "ozon-delivery", "Санкт-Петербург"],
    ["Россия, Москва, Ленинский проспект, 23", "ozon-delivery", "Москва"],
    ["Россия, Москва, 2-я Фрунзенская улица, 10", "ozon-delivery", "Москва"],
    ["Россия, Адыгея Республика, Тахтамукайский Район, Яблоновский, улица Гагарина, 190/2", "ozon-delivery", "Яблоновский"],
    ["РФ, Московская область, г. Химки, ул. Ленина, 1", "cdek-delivery", "Химки"],
    ["Россия, Москва, Приморский район, переулок Тестовый, 1", "ozon-delivery", "Москва"],
    ["123456, Москва, Садовая, 1", "russian-post", "Москва"],
    ["Казань, улица Тестовая, 10", "russian-post", "Казань"],
  ])("extracts a locality from %s", (address, provider, expected) => {
    expect(destinationCity(address, provider)).toBe(expected);
  });

  it.each([
    [null, "ozon-delivery"],
    ["Самовывоз по согласованию", "pickup"],
    ["Самовывоз, по согласованию", "pickup"],
    ["улица Садовая, дом 2", "ozon-delivery"],
    ["Россия, Московская область, район Пушкино, улица Тестовая, 1", "ozon-delivery"],
    ["Россия, Московская область, неизвестный адрес", "ozon-delivery"],
    ["Россия, Санкт-Петербург", "ozon-delivery"],
  ])("does not guess a destination from %s", (address, provider) => {
    expect(destinationCity(address, provider)).toBeNull();
  });
});
