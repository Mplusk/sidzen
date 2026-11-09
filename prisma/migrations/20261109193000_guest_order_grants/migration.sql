CREATE TABLE "GuestOrderGrant" (
    "tokenHash" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestOrderGrant_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "GuestOrderGrant_orderNumber_idx" ON "GuestOrderGrant"("orderNumber");
CREATE INDEX "GuestOrderGrant_expiresAt_idx" ON "GuestOrderGrant"("expiresAt");
