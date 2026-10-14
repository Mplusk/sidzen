ALTER TABLE "Product" ADD COLUMN "catalogFacetVersion" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Product_catalogFacetVersion_id_idx" ON "Product"("catalogFacetVersion", "id");
CREATE TABLE "CatalogFacet" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "CatalogFacet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogFacet_kind_slug_key" ON "CatalogFacet"("kind", "slug");
CREATE TABLE "_CatalogFacetToProduct" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_CatalogFacetToProduct_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_CatalogFacetToProduct_B_index" ON "_CatalogFacetToProduct"("B");
ALTER TABLE "_CatalogFacetToProduct" ADD CONSTRAINT "_CatalogFacetToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "CatalogFacet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CatalogFacetToProduct" ADD CONSTRAINT "_CatalogFacetToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
