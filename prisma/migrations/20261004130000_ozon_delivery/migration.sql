ALTER TABLE "Product" ADD COLUMN "shippingWeightG" INTEGER, ADD COLUMN "shippingLengthMm" INTEGER, ADD COLUMN "shippingWidthMm" INTEGER, ADD COLUMN "shippingHeightMm" INTEGER;
CREATE TABLE "OzonDeliveryJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "shipmentId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "request" JSONB NOT NULL, "response" JSONB, "status" TEXT NOT NULL DEFAULT 'PENDING', "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0, "lockedUntil" TIMESTAMP(3), "lockToken" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OzonDeliveryJob_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OzonDeliveryJob_shipmentId_key" ON "OzonDeliveryJob"("shipmentId");
CREATE UNIQUE INDEX "OzonDeliveryJob_idempotencyKey_key" ON "OzonDeliveryJob"("idempotencyKey");
CREATE INDEX "OzonDeliveryJob_status_nextAttemptAt_idx" ON "OzonDeliveryJob"("status", "nextAttemptAt");
CREATE TABLE "OzonDeliveryPoint" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "address" TEXT NOT NULL, "type" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "clientId" TEXT NOT NULL, "methodId" BIGINT NOT NULL, "generation" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "OzonDeliveryPoint_clientId_methodId_active_idx" ON "OzonDeliveryPoint"("clientId", "methodId", "active");
CREATE TABLE "OzonDeliverySync" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'ozon', "clientId" TEXT NOT NULL, "methodId" BIGINT NOT NULL, "generation" TEXT NOT NULL,
  "cursor" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING', "pages" INTEGER NOT NULL DEFAULT 0, "points" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "lockedUntil" TIMESTAMP(3), "lockToken" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL
);
