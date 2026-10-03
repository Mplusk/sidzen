ALTER TABLE "Product" ADD COLUMN "marketplaceMode" TEXT NOT NULL DEFAULT 'AUTO';
CREATE TABLE "MarketplaceIdentity" (
  "key" TEXT NOT NULL, "productId" TEXT NOT NULL,
  CONSTRAINT "MarketplaceIdentity_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "MarketplaceIdentity_productId_idx" ON "MarketplaceIdentity"("productId");
ALTER TABLE "MarketplaceIdentity" ADD CONSTRAINT "MarketplaceIdentity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "MarketplaceListing" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL, "sellerSku" TEXT NOT NULL, "normalizedSku" TEXT NOT NULL,
  "barcodes" TEXT[] NOT NULL, "snapshot" JSONB NOT NULL,
  "productId" TEXT, "conflict" TEXT, "lastRunId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplaceListing_provider_accountId_externalId_key" ON "MarketplaceListing"("provider", "accountId", "externalId");
CREATE UNIQUE INDEX "MarketplaceListing_provider_accountId_productId_key" ON "MarketplaceListing"("provider", "accountId", "productId");
CREATE INDEX "MarketplaceListing_normalizedSku_idx" ON "MarketplaceListing"("normalizedSku");
CREATE INDEX "MarketplaceListing_productId_idx" ON "MarketplaceListing"("productId");
CREATE INDEX "MarketplaceListing_conflict_idx" ON "MarketplaceListing"("conflict");
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "MarketplaceSyncRun" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "actorId" TEXT, "cursor" JSONB,
  "processed" INTEGER NOT NULL DEFAULT 0, "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0, "conflicts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  CONSTRAINT "MarketplaceSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketplaceSyncRun_status_createdAt_idx" ON "MarketplaceSyncRun"("status", "createdAt");
