ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Order" ADD COLUMN "personalDataErasedAt" TIMESTAMP(3), ADD COLUMN "privacyClosedAt" TIMESTAMP(3), ADD COLUMN "retentionHoldUntil" TIMESTAMP(3), ADD COLUMN "retentionHoldReason" TEXT;
UPDATE "Order" SET "privacyClosedAt" = COALESCE("deletedAt", "updatedAt") WHERE "deletedAt" IS NOT NULL OR "status" IN ('DELIVERED', 'CANCELED', 'REFUNDED');
CREATE TABLE "PrivacyErasure" (
 "id" TEXT NOT NULL, "subjectHash" TEXT NOT NULL, "reason" TEXT NOT NULL, "plan" JSONB NOT NULL,
 "retainedUntil" TIMESTAMP(3), "filesRemovedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivacyErasure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivacyErasure_createdAt_idx" ON "PrivacyErasure"("createdAt");
CREATE INDEX "PrivacyErasure_filesRemovedAt_idx" ON "PrivacyErasure"("filesRemovedAt");
CREATE INDEX "Order_privacyClosedAt_idx" ON "Order"("privacyClosedAt");
