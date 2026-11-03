CREATE TABLE "CdekDeliveryJob" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "remoteId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lockToken" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelRequestedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CdekDeliveryJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CdekDeliveryJob_shipmentId_key" ON "CdekDeliveryJob"("shipmentId");
CREATE UNIQUE INDEX "CdekDeliveryJob_remoteId_key" ON "CdekDeliveryJob"("remoteId");
CREATE INDEX "CdekDeliveryJob_status_nextAttemptAt_idx" ON "CdekDeliveryJob"("status", "nextAttemptAt");
CREATE INDEX "CdekDeliveryJob_cancelRequestedAt_nextAttemptAt_idx" ON "CdekDeliveryJob"("cancelRequestedAt", "nextAttemptAt");
ALTER TABLE "CdekDeliveryJob" ADD CONSTRAINT "CdekDeliveryJob_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
