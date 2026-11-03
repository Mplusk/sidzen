CREATE TABLE "YooKassaSettlement" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "externalId" TEXT,
  "firstAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YooKassaSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "YooKassaSettlement_orderId_key" ON "YooKassaSettlement"("orderId");
CREATE UNIQUE INDEX "YooKassaSettlement_externalId_key" ON "YooKassaSettlement"("externalId");
CREATE INDEX "YooKassaSettlement_status_nextAttemptAt_idx" ON "YooKassaSettlement"("status", "nextAttemptAt");
ALTER TABLE "YooKassaSettlement" ADD CONSTRAINT "YooKassaSettlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
