import { expect, it } from "vitest";
import { productColorFromSpecifications } from "./product-color";

it("reads color from recognized product characteristics", () => {
  expect(productColorFromSpecifications({ "Цвет товара": "Чёрный", "Материал": "PLA" })).toBe("Чёрный");
  expect(productColorFromSpecifications({ "Основной цвет": ["Белый", "Чёрный"] })).toBe("Белый, Чёрный");
  expect(productColorFromSpecifications({ "Цвет упаковки": "Белый" })).toBeNull();
  expect(productColorFromSpecifications(null)).toBeNull();
});
