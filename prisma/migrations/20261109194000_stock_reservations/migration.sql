ALTER TABLE "Product" ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "inventoryTracked" BOOLEAN NOT NULL DEFAULT false;
-- Already closed historical orders are outside the active-order reconciliation
-- queue. Existing active orders remain blocked until explicitly reviewed.
UPDATE "Order" SET "inventoryTracked" = true WHERE "status" IN ('DELIVERED', 'CANCELED', 'REFUNDED');
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
ALTER TABLE "OrderItem" ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stockReservationState" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Product" ADD CONSTRAINT "Product_reservedStock_nonnegative" CHECK ("reservedStock" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_stockReservation_valid" CHECK (
  "reservedStock" >= 0 AND "stockReservationState" IN ('NONE', 'ACTIVE', 'RELEASED', 'CONSUMED')
);
