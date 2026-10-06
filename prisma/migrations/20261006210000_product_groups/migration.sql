CREATE TABLE "ProductGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceKey" TEXT,
  CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductGroup_sourceKey_key" ON "ProductGroup"("sourceKey");
ALTER TABLE "Product" ADD COLUMN "groupId" TEXT,
  ADD COLUMN "groupLabel" TEXT,
  ADD COLUMN "groupingMode" TEXT NOT NULL DEFAULT 'AUTO';
CREATE INDEX "Product_groupId_idx" ON "Product"("groupId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
