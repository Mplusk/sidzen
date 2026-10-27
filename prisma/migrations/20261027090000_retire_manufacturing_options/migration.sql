BEGIN;
SELECT pg_advisory_xact_lock(73412027);
-- Retire current choices without rewriting any historical OrderItem or amount.
-- Legacy dictionaries/variant relations remain for historical referential integrity.
INSERT INTO "AuditLog" ("id", "action", "entityType", "after", "createdAt")
SELECT 'manufacturing-options-retired-20261027', 'product-options.retire', 'Product',
  jsonb_build_object('technologyLinks', (SELECT count(*) FROM "_ProductToTechnology"), 'qualityLinks', (SELECT count(*) FROM "_ProductToQualityProfile"), 'postProcessLinks', (SELECT count(*) FROM "_PostProcessOptionToProduct")), CURRENT_TIMESTAMP;
DELETE FROM "_ProductToTechnology";
DELETE FROM "_ProductToQualityProfile";
DELETE FROM "_PostProcessOptionToProduct";
UPDATE "Technology" SET "active" = false;
UPDATE "QualityProfile" SET "active" = false;
UPDATE "PostProcessOption" SET "active" = false;
-- Only live carts are mutable. Current prices are recalculated on read/checkout.
UPDATE "CartItem" SET "config" = "config" - ARRAY['quality', 'qualityName', 'qualityProfileId', 'technology', 'technologyName', 'technologyId', 'postProcess', 'postProcesses', 'postProcessIds'] WHERE jsonb_typeof("config") = 'object';
UPDATE "CartItem" SET "variantId" = NULL
WHERE "variantId" IN (SELECT "id" FROM "ProductVariant" WHERE "qualityProfileId" IS NOT NULL);
DELETE FROM "_CatalogFacetToProduct" WHERE "A" IN (SELECT "id" FROM "CatalogFacet" WHERE "kind" = 'technology');
DELETE FROM "CatalogFacet" WHERE "kind" = 'technology';
COMMIT;
