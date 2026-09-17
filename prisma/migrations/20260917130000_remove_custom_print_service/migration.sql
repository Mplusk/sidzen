-- Remove the retired service, not customer orders. Historical migrations/schema
-- values remain for backward-compatible deployment and recovery.
BEGIN;
UPDATE "Category" SET "image" = '/generated/product-enclosure.webp' WHERE "image" = '/generated/product-custom-print.webp';
DELETE FROM "Product" WHERE "slug" = 'custom-model-print' AND "sku" = 'PRINT-FILE-01' AND "type" = 'PRINT_TEMPLATE';
DELETE FROM "SeoPage" WHERE "path" = '/print/';
DELETE FROM "Redirect" WHERE "fromPath" LIKE '/print/%' OR "toPath" LIKE '/print/%';
DELETE FROM "SiteSetting" WHERE "key" IN ('print.minimumOrder', 'print.maxUploadMb');
DELETE FROM "Article" WHERE "slug" IN ('kak-podgotovit-stl', 'stoimost-3d-pechati');
DELETE FROM "FaqItem" WHERE "scope" = 'general' AND "question" IN (
  'Какие форматы моделей принимаете?', 'Расчёт на сайте окончательный?',
  'Можно напечатать одну деталь?', 'Можно заказать серию?'
);
COMMIT;
