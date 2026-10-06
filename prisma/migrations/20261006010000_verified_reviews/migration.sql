ALTER TABLE "Review" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "buyerKey" TEXT,
  ADD COLUMN "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentId" TEXT;
UPDATE "Review" SET "status" = 'PUBLISHED' WHERE "approved" = true;
CREATE UNIQUE INDEX "Review_buyerKey_key" ON "Review"("buyerKey");
CREATE UNIQUE INDEX "Review_consentId_key" ON "Review"("consentId");
ALTER TABLE "Review" ADD CONSTRAINT "Review_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "PrivacyConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "ReviewImage" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ReviewImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReviewImage_fileName_key" ON "ReviewImage"("fileName");
CREATE INDEX "ReviewImage_reviewId_sortOrder_idx" ON "ReviewImage"("reviewId", "sortOrder");
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
