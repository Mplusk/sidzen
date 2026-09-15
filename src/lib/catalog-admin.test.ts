import { describe, expect, it } from "vitest";
import { catalogOptionInUse, parseCatalogCreate, parseCatalogDelete, type CatalogKind } from "./catalog-admin";

function createForm(kind: CatalogKind) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("name", "Новый вариант");
  form.set("slug", "");
  form.set("description", "Описание");
  if (kind === "material") {
    form.set("type", "пластик");
    form.set("density", "1.24");
    form.set("pricePerGram", "8.50");
  }
  if (kind === "color") form.set("hex", "#12aBcD");
  if (kind === "quality") {
    form.set("layerHeightMm", "0.2");
    form.set("speedMultiplier", "1");
    form.set("priceMultiplier", "1.2");
  }
  if (kind === "postProcess") {
    form.set("price", "350");
    form.set("leadDays", "2");
  }
  return form;
}

describe("catalog administration", () => {
  it.each(["category", "material", "color", "technology", "quality", "postProcess"] as const)("validates and creates a slug for %s", (kind) => {
    const parsed = parseCatalogCreate(createForm(kind));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.slug).toBe("novyy-variant");
  });

  it("rejects missing numeric fields and malformed colors", () => {
    const material = createForm("material");
    material.set("density", "");
    expect(parseCatalogCreate(material).success).toBe(false);

    const color = createForm("color");
    color.set("hex", "javascript:alert(1)");
    expect(parseCatalogCreate(color).success).toBe(false);

    const post = createForm("postProcess");
    post.set("leadDays", "1.5");
    expect(parseCatalogCreate(post).success).toBe(false);
  });

  it("accepts only known kinds and nonempty IDs for deletion", () => {
    const form = new FormData();
    form.set("kind", "category");
    form.set("id", "category-1");
    expect(parseCatalogDelete(form).success).toBe(true);
    form.set("kind", "unknown");
    expect(parseCatalogDelete(form).success).toBe(false);
  });

  it("treats any product or order reference as in use", () => {
    expect(catalogOptionInUse({ products: 0, orderItems: 0 })).toBe(false);
    expect(catalogOptionInUse({ products: 0, orderItems: 1 })).toBe(true);
  });
});
