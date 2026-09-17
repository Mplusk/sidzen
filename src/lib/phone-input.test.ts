import { expect, it } from "vitest";
import { phoneMask } from "./phone-input";
it("formats pasted numbers and allows backspacing through separators", () => {
  expect(phoneMask("89991234567")).toBe("+7 (999) 123-45-67");
  expect(phoneMask("+7 (999) ")).toBe("+7 (999");
  expect(phoneMask("+7 (99")).toBe("+7 (99");
  expect(phoneMask("+7 (999) 123-")).toBe("+7 (999) 123");
  expect(phoneMask("")).toBe("");
});
