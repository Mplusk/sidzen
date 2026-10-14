import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { backfillCatalogFacets, refreshCatalogFacets } from "../src/lib/catalog-facets-server";
import { productOptions, productOptionInclude } from "../src/lib/product-options-server";
import { defaultSelection, priceProduct } from "../src/lib/product-options";

// Synthetic local/CI fixtures only. No marketplace or customer requests.
const base = process.env.QA_URL ?? "http://127.0.0.1:3101";
const db = new URL(process.env.DATABASE_URL ?? ""), host = new URL(base);
assert(["localhost", "127.0.0.1"].includes(host.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && ["/shop_qa", "/sidzen_uiqa", "/sidzen_qa"].includes(db.pathname));
const prefix = `qa-usability-${randomUUID().slice(0, 8)}`;
const category = await prisma.category.create({ data: { slug: prefix, name: "QA каталог", visible: true } });
const ids: string[] = [];
try {
  for (const status of ["PUBLISHED", "DRAFT"] as const) {
    const product = await prisma.product.create({ data: { name: `Чаша коралл ${prefix} ${status}`, sku: `${prefix}-${status}`, slug: `${prefix}-${status.toLowerCase()}`, basePrice: "149.99", stock: 2, madeToOrder: false, status, specifications: { "Материал изделия": "PLA пластик", "Цвет": "розовый", "Высота предмета, см": "4.5" }, heightMm: 45, categories: { create: { categoryId: category.id, isPrimary: true } }, images: { create: { path: "/generated/product-organizer.webp", alt: "QA изделие", width: 1024, height: 1024 } } } });
    ids.push(product.id);
  }
  while (await backfillCatalogFacets()) { /* bounded batches */ }
  const product = await prisma.product.findUniqueOrThrow({ where: { id: ids[0] }, include: { ...productOptionInclude, catalogFacets: true } });
  assert(product.catalogFacets.some(facet => facet.kind === "material" && facet.slug === "pla"));
  assert.equal(product.materials.length, 0); assert.equal(product.colors.length, 0);
  const options = productOptions(product); assert.equal(priceProduct(options, defaultSelection(options)).unitPrice, 150);
  assert.equal(Number(product.basePrice), 149.99);
  const suggestions = await (await fetch(`${base}/api/catalog/suggestions/?q=${prefix}%20%D0%A7%D0%B0%D1%88%D0%B0`)).json();
  assert(suggestions.products.some((row: { id: string }) => row.id === ids[0]));
  assert(!suggestions.products.some((row: { id: string }) => row.id === ids[1]));
  const html = await (await fetch(`${base}/catalog/${prefix}/?material=pla`)).text();
  assert(html.includes(`${prefix}-published`)); assert(!html.includes(`${prefix}-draft`));
  assert(html.includes('mobile-purchase-bar') === false);
  const card = await (await fetch(`${base}/catalog/${prefix}/${prefix}-published/`)).text();
  assert(card.includes('product-mobile-price')); assert(card.includes('mobile-purchase-bar'));
  assert(!card.includes('Высота предмета, см')); assert(card.includes('45 мм'));
  await prisma.$transaction(tx => refreshCatalogFacets(tx, ids[0]));
  assert.equal(await prisma.catalogFacet.count({ where: { products: { some: { id: ids[0] } } } }), 2);
  console.log("PASS: catalog backfill, PLA filter, public-only suggestions, price/cart-option isolation, idempotence, mobile purchase and normalized dimensions.");
  if (process.env.QA_KEEP_FIXTURES === "true") console.log(`QA page: ${base}/catalog/${prefix}/${prefix}-published/`);
} finally {
  if (process.env.QA_KEEP_FIXTURES !== "true") {
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.category.delete({ where: { id: category.id } });
  }
  await prisma.$disconnect();
}
