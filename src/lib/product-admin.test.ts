import { describe, expect, it } from "vitest";
import { arrangeProductImages, assertImageCapacity, parseGallery, parseProductForm, parseSpecifications, serializeGallery, storedProductImageName } from "./product-admin";

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
  it("allows an AI draft without a category but requires a real selection before publication/manual mode", () => {
    const form = validForm(); form.set("categoryMode", "AI"); form.set("primaryCategoryId", "");
    expect(parseProductForm(form)).toMatchObject({ success: true, data: { categoryMode: "AI", categoryIds: [] } });
    form.set("status", "PUBLISHED"); expect(parseProductForm(form).success).toBe(false);
    form.set("status", "DRAFT"); form.set("categoryMode", "MANUAL"); expect(parseProductForm(form).success).toBe(false);
    form.set("primaryCategoryId", "category-1"); expect(parseProductForm(form).success).toBe(true);
    form.delete("categoryMode"); expect(parseProductForm(form)).toMatchObject({ success: true, data: { categoryMode: "MANUAL" } });
  });
  it("does not allow recreating a retired custom-print service", () => {
    const form = validForm();
    form.set("type", "PRINT_TEMPLATE");
    expect(parseProductForm(form).success).toBe(false);
  });
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

  it("keeps a caption separate when the alt text is empty", () => {
    expect(parseGallery(serializeGallery([{ path: "/a.webp", alt: "", caption: "Вид сбоку" }]), "Товар")[0]).toMatchObject({ alt: "Товар", caption: "Вид сбоку" });
  });

  it("can make an uploaded photo the cover and preserve metadata and dimensions", () => {
    const images = [{ path: "/old.webp", alt: "Старое", sortOrder: 0, width: 400 }, { path: "/new.webp", alt: "Товар", sortOrder: 1, width: 800 }];
    const arranged = arrangeProductImages(images, JSON.stringify([{ index: 1, alt: "", caption: "Новый вид" }, { index: 0, alt: "Сбоку", caption: "" }]));
    expect(arranged).toEqual([{ path: "/new.webp", alt: "Товар", caption: "Новый вид", sortOrder: 0, width: 800 }, { path: "/old.webp", alt: "Сбоку", caption: undefined, sortOrder: 1, width: 400 }]);
  });

  it("rejects a gallery order that duplicates, omits or invents photos", () => {
    const images = [{ path: "/a.webp", alt: "A", sortOrder: 0 }, { path: "/b.webp", alt: "B", sortOrder: 1 }];
    for (const indices of [[0, 0], [0], [0, 2], [-1, 1]]) {
      expect(() => arrangeProductImages(images, JSON.stringify(indices.map((index) => ({ index, alt: "", caption: "" }))))).toThrow();
    }
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
