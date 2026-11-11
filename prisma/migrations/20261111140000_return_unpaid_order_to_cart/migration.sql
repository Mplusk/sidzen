ALTER TABLE "Order" ADD COLUMN "checkoutCartId" TEXT,
ADD COLUMN "cartRestoredAt" TIMESTAMP(3);

ALTER TABLE "OrderItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN "returnedOrderItemId" TEXT;

CREATE INDEX "Order_checkoutCartId_idx" ON "Order"("checkoutCartId");
CREATE UNIQUE INDEX "CartItem_returnedOrderItemId_key" ON "CartItem"("returnedOrderItemId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutCartId_fkey"
  FOREIGN KEY ("checkoutCartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_returnedOrderItemId_fkey"
  FOREIGN KEY ("returnedOrderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing timed orders must not keep the old, extendable payment window.
-- Bindings are written by the server; malformed historical JSON is skipped.
UPDATE "Order" AS o
SET "reservationExpiresAt" = LEAST(
  o."reservationExpiresAt",
  ((p."payload"->>'firstAttemptAt')::timestamptz + INTERVAL '10 minutes') AT TIME ZONE 'UTC'
)
FROM "Payment" AS p
WHERE p."orderId" = o."id"
  AND p."provider" = 'yookassa-online'
  AND p."status" = 'PENDING'
  AND p."payload"->>'version' = '1'
  AND o."reservationExpiresAt" IS NOT NULL
  AND o."reservationExpiredAt" IS NULL
  AND pg_input_is_valid(p."payload"->>'firstAttemptAt', 'timestamp with time zone');
