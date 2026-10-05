ALTER TABLE "Payment" ADD COLUMN "refundReviewRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "FiscalReceipt" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING_PAYMENT', "publicId" TEXT NOT NULL,
  "inn" TEXT NOT NULL, "request" TEXT NOT NULL, "externalId" TEXT,
  "requestId" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL,
  "firstAttemptAt" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT, "receiptUrl" TEXT, "fiscalData" JSONB, "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiscalReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FiscalReceipt_externalId_key" ON "FiscalReceipt"("externalId");
CREATE UNIQUE INDEX "FiscalReceipt_requestId_key" ON "FiscalReceipt"("requestId");
CREATE UNIQUE INDEX "FiscalReceipt_orderId_kind_key" ON "FiscalReceipt"("orderId", "kind");
CREATE INDEX "FiscalReceipt_status_nextAttemptAt_idx" ON "FiscalReceipt"("status", "nextAttemptAt");
