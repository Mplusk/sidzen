ALTER TABLE "Order" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reservationExpiredAt" TIMESTAMP(3),
  ADD COLUMN "stockReviewRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Order_reservationExpiresAt_idx" ON "Order"("reservationExpiresAt");

CREATE TABLE "CartStockHold" (
  "id" TEXT NOT NULL,
  "cartId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CartStockHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartStockHold_cartId_key" ON "CartStockHold"("cartId");
CREATE INDEX "CartStockHold_expiresAt_idx" ON "CartStockHold"("expiresAt");
ALTER TABLE "CartStockHold" ADD CONSTRAINT "CartStockHold_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CartStockHoldItem" (
  "id" TEXT NOT NULL,
  "holdId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "CartStockHoldItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartStockHoldItem_positive_quantity" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "CartStockHoldItem_holdId_productId_key" ON "CartStockHoldItem"("holdId", "productId");
CREATE INDEX "CartStockHoldItem_productId_idx" ON "CartStockHoldItem"("productId");
ALTER TABLE "CartStockHoldItem" ADD CONSTRAINT "CartStockHoldItem_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "CartStockHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartStockHoldItem" ADD CONSTRAINT "CartStockHoldItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
