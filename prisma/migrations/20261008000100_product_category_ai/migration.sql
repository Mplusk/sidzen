ALTER TABLE "Product" ADD COLUMN "categoryMode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryMode_check" CHECK ("categoryMode" IN ('MANUAL', 'AI'));
CREATE TABLE "ProductCategoryAiJob" (
  "productId" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCategoryAiJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductCategoryAiJob_status_availableAt_idx" ON "ProductCategoryAiJob"("status", "availableAt");
