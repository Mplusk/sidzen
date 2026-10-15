import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { backfillCatalogFacets, refreshCatalogFacets } from "../src/lib/catalog-facets-server";
import { productOptions, productOptionInclude } from "../src/lib/product-options-server";
import { defaultSelection, priceProduct } from "../src/lib/product-options";
import { formatPrice } from "../src/lib/format";

// Synthetic local/CI fixtures only. No marketplace or customer requests.
const base = process.env.QA_URL ?? "http://127.0.0.1:3101";
const db = new URL(process.env.DATABASE_URL ?? ""), host = new URL(base);
assert(["localhost", "127.0.0.1"].includes(host.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && ["/shop_qa", "/sidzen_uiqa", "/sidzen_qa"].includes(db.pathname));
const prefix = `qa-usability-${randomUUID().slice(0, 8)}`;
const category = await prisma.category.create({ data: { slug: prefix, name: "QA каталог", visible: true } });
const ids: string[] = [];
const qualityIds: string[] = [];
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
  const quality = await prisma.qualityProfile.create({ data: { name: "QA качество", slug: `${prefix}-quality`, layerHeightMm: ".2", priceMultiplier: "1.75" } });
  qualityIds.push(quality.id);
  for (const kind of ["variant", "quality"] as const) {
    const extra = await prisma.product.create({ data: { name: `${prefix} ${kind}`, sku: `${prefix}-${kind}`, slug: `${prefix}-${kind}`, basePrice: kind === "variant" ? 1000 : 100, stock: 1, status: "PUBLISHED", madeToOrder: false,
      categories: { create: { categoryId: category.id, isPrimary: true } },
      ...(kind === "variant" ? { variants: { create: { sku: `${prefix}-override`, price: "99.25", stock: 1 } } } : { qualityProfiles: { connect: { id: quality.id } } }),
    } });
    ids.push(extra.id);
  }
  const cards = (markup: string) => [...markup.matchAll(/<article class="product-card">[\s\S]*?<\/article>/g)].map(match => match[0]);
  // Different URL/cache keys from the initial facet test above.
  const asc = await (await fetch(`${base}/catalog/${prefix}/?sort=price-asc`)).text();
  const ascending = cards(asc);
  assert.equal(ascending.length, 3);
  assert(ascending[0].includes(`${prefix}-variant`) && ascending[0].includes(`<strong>${formatPrice(99.25)}</strong>`));
  assert(ascending[1].includes(`${prefix}-published`) && ascending[1].includes(`<strong>${formatPrice(150)}</strong>`));
  assert(ascending[2].includes(`${prefix}-quality`) && ascending[2].includes(`<strong>${formatPrice(175)}</strong>`));
  const desc = cards(await (await fetch(`${base}/catalog/${prefix}/?sort=price-desc`)).text());
  assert(desc[0].includes(`${prefix}-quality`) && desc[2].includes(`${prefix}-variant`));
  const exact = cards(await (await fetch(`${base}/catalog/${prefix}/?min=99.25&max=99.25`)).text());
  assert.equal(exact.length, 1); assert(exact[0].includes(`${prefix}-variant`));
  const rounded = cards(await (await fetch(`${base}/catalog/${prefix}/?min=150&max=150`)).text());
  assert.equal(rounded.length, 1); assert(rounded[0].includes(`${prefix}-published`));
  const query = `${prefix} variant`;
  const searchHtml = await (await fetch(`${base}/catalog/${prefix}/?q=${encodeURIComponent(query)}`)).text();
  assert(searchHtml.match(/<input\b[^>]*id="shop-search"[^>]*>/)?.[0].includes(`value="${query}"`), "Search input must contain the URL query in server-rendered HTML");
  assert(!searchHtml.includes("<legend>Технология</legend>"));
  const pricedSuggestions = await (await fetch(`${base}/api/catalog/suggestions/?q=${encodeURIComponent(query)}`)).json();
  assert.equal(pricedSuggestions.products.find((row: { id: string }) => row.id === ids[2])?.price, 99.25);
  const variantPage = await (await fetch(`${base}/catalog/${prefix}/${prefix}-variant/`)).text();
  assert(variantPage.includes(`<strong>${formatPrice(99.25)}</strong>`) && variantPage.includes('"price":99.25'));
  // Exercise a real database cursor across the 200-candidate pricing batch,
  // and make sure price filtering happens before the 30-card page boundary.
  const bulkIds = Array.from({ length: 201 }, () => randomUUID());
  ids.push(...bulkIds);
  await prisma.product.createMany({ data: bulkIds.map((id, i) => ({ id, name: `${prefix} page ${i}`, sku: `${prefix}-page-${i}`, slug: `${prefix}-page-${i}`, basePrice: 5000 + i, stock: 0, status: "PUBLISHED", madeToOrder: false })) });
  await prisma.productCategory.createMany({ data: bulkIds.map(productId => ({ productId, categoryId: category.id, isPrimary: true })) });
  const secondPage = cards(await (await fetch(`${base}/catalog/${prefix}/?sort=price-asc&min=5000&max=5200&page=2`)).text());
  assert.equal(secondPage.length, 30); assert(secondPage[0].includes(`${prefix}-page-30/`) && secondPage[29].includes(`${prefix}-page-59/`));
  console.log("PASS: catalog facets, public-only suggestions, shared variant/quality/rounded prices, sorting, price bounds, persistent search and hidden empty groups.");
  if (process.env.QA_KEEP_FIXTURES === "true") console.log(`QA page: ${base}/catalog/${prefix}/${prefix}-published/`);
} finally {
  if (process.env.QA_KEEP_FIXTURES !== "true") {
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.qualityProfile.deleteMany({ where: { id: { in: qualityIds } } });
    await prisma.category.delete({ where: { id: category.id } });
  }
  await prisma.$disconnect();
}
