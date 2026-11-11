ALTER TABLE "OrderItem" ADD COLUMN "groupLabel" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "productColor" TEXT;

CREATE TABLE "TelegramOrderStatusJob" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramOrderStatusJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramOrderStatusJob_orderId_kind_key" ON "TelegramOrderStatusJob"("orderId", "kind");
CREATE INDEX "TelegramOrderStatusJob_status_availableAt_idx" ON "TelegramOrderStatusJob"("status", "availableAt");
ALTER TABLE "TelegramOrderStatusJob" ADD CONSTRAINT "TelegramOrderStatusJob_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
