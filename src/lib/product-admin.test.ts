import { describe, expect, it } from "vitest";
import { assertImageCapacity, parseGallery, parseProductForm, parseSpecifications, serializeGallery, storedProductImageName } from "./product-admin";

function validForm() {
  const form = new FormData();
  form.set("name", "Настольный держатель");
  form.set("slug", "desk-holder");
  form.set("sku", "DESK-01");
  form.set("type", "READY");
  form.set("status", "DRAFT");
  form.set("basePrice", "1290");
  form.set("stock", "4");
  form.set("leadDays", "2");
  form.set("robots", "index,follow");
  form.set("primaryCategoryId", "category-1");
  return form;
}

describe("product admin form", () => {
  it("normalizes categories and structured fields", () => {
    const form = validForm();
    form.append("categoryIds", "category-2");
    form.append("categoryIds", "category-1");
    form.set("specificationsText", "{\"Слой\":\"0,2 мм\"}");
    form.set("imagesText", "/generated/item.webp | Изделие | Главный вид");
    const result = parseProductForm(form);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryIds).toEqual(["category-1", "category-2"]);
      expect(result.data.specifications).toEqual({ "Слой": "0,2 мм" });
      expect(result.data.images[0]).toMatchObject({ path: "/generated/item.webp", alt: "Изделие", caption: "Главный вид" });
    }
  });

  it("rejects arrays as specifications and unsafe image paths", () => {
    expect(() => parseSpecifications("[]")).toThrow();
    expect(() => parseGallery("/uploads/../secret.webp | test", "fallback")).toThrow();
  });

  it("serializes editable gallery rows", () => {
    expect(serializeGallery([{ path: "/a.webp", alt: "A", caption: "Вид" }])).toBe("/a.webp | A | Вид");
  });

  it("enforces the total gallery limit before and after uploads", () => {
    expect(() => assertImageCapacity(19, 1)).not.toThrow();
    expect(() => assertImageCapacity(19, 2)).toThrow("images");
    expect(() => parseGallery(Array.from({ length: 21 }, (_, index) => `/generated/${index}.webp`).join("\n"), "Alt")).toThrow("images");
  });

  it("only identifies product-upload paths with generated UUID names for cleanup", () => {
    const name = "cab33247-58f7-4c6c-a8ff-19035ea60b31.webp";
    expect(storedProductImageName(`/uploads/products/${name}`)).toBe(name);
    expect(storedProductImageName("/uploads/products/../../private/file.webp")).toBeNull();
    expect(storedProductImageName("/generated/product.webp")).toBeNull();
  });
});
