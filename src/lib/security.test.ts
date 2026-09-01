import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { slugify } from "@/lib/format";

describe("credentials and urls", () => {
  it("stores salted password hashes", () => {
    const first = hashPassword("correct horse battery staple");
    const second = hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(verifyPassword("wrong password", first)).toBe(false);
  });

  it("creates stable transliterated slugs", () => {
    expect(slugify("Крепление для GoPro 3D")).toBe("kreplenie-dlya-gopro-3d");
  });
});
