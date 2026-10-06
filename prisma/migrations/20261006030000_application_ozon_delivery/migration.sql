ALTER TABLE "OzonDeliveryJob" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3), ADD COLUMN "cancelError" TEXT;
CREATE INDEX "OzonDeliveryJob_cancelRequestedAt_nextAttemptAt_idx" ON "OzonDeliveryJob"("cancelRequestedAt", "nextAttemptAt");
