CREATE TABLE "FivePostDeliveryJob" (
    "id" TEXT PRIMARY KEY, "shipmentId" TEXT NOT NULL, "warehouseId" TEXT NOT NULL, "senderLocation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING', "remoteId" TEXT, "deliveryStatus" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelRequestedAt" TIMESTAMP(3), "lockedUntil" TIMESTAMP(3), "lockToken" TEXT, "error" TEXT,
    CONSTRAINT "FivePostDeliveryJob_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FivePostDeliveryJob_shipmentId_key" ON "FivePostDeliveryJob" ("shipmentId");
CREATE UNIQUE INDEX "FivePostDeliveryJob_remoteId_key" ON "FivePostDeliveryJob" ("remoteId");
CREATE INDEX "FivePostDeliveryJob_status_nextAttemptAt_idx" ON "FivePostDeliveryJob" ("status", "nextAttemptAt");
CREATE TABLE "FivePostDirectory" (
    "id" TEXT PRIMARY KEY, "scope" TEXT NOT NULL, "active" TEXT, "staging" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 0, "refreshedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "error" TEXT
);
CREATE TABLE "FivePostPoint" (
    "generation" TEXT NOT NULL, "id" TEXT NOT NULL, "city" TEXT NOT NULL, "cityKey" TEXT NOT NULL, "region" TEXT NOT NULL,
    "name" TEXT NOT NULL, "address" TEXT NOT NULL, "type" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL, "details" JSONB NOT NULL,
    PRIMARY KEY ("generation", "id")
);
CREATE INDEX "FivePostPoint_generation_cityKey_region_idx" ON "FivePostPoint" ("generation", "cityKey", "region");
CREATE INDEX "FivePostPoint_generation_latitude_longitude_idx" ON "FivePostPoint" ("generation", "latitude", "longitude");
