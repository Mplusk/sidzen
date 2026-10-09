CREATE TABLE "ReviewAiJob" (
  "reviewId" TEXT NOT NULL PRIMARY KEY,
  "consentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewAiJob_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReviewAiJob_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "PrivacyConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReviewAiJob_consentId_key" ON "ReviewAiJob"("consentId");
CREATE INDEX "ReviewAiJob_status_availableAt_idx" ON "ReviewAiJob"("status", "availableAt");
CREATE TABLE "TelegramOrderJob" (
  "orderId" TEXT NOT NULL PRIMARY KEY,
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
  CONSTRAINT "TelegramOrderJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TelegramOrderJob_status_availableAt_idx" ON "TelegramOrderJob"("status", "availableAt");
