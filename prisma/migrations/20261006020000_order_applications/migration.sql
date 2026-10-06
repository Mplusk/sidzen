ALTER TYPE "OrderStatus" ADD VALUE 'IN_PROGRESS';
ALTER TABLE "Order"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ORDER',
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "purchaseConfirmedAt" TIMESTAMP(3);
CREATE INDEX "Order_deletedAt_status_createdAt_idx" ON "Order"("deletedAt", "status", "createdAt");
