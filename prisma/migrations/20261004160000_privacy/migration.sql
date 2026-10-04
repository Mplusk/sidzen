CREATE TABLE "PrivacyConsent" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "orderId" TEXT, "subjectHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL, "version" TEXT NOT NULL, "document" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  CONSTRAINT "PrivacyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PrivacyConsent_userId_createdAt_idx" ON "PrivacyConsent"("userId", "createdAt");
CREATE INDEX "PrivacyConsent_purpose_expiresAt_idx" ON "PrivacyConsent"("purpose", "expiresAt");
CREATE TABLE "PrivacyRequest" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "message" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "response" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivacyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PrivacyRequest_userId_createdAt_idx" ON "PrivacyRequest"("userId", "createdAt");
CREATE INDEX "PrivacyRequest_status_createdAt_idx" ON "PrivacyRequest"("status", "createdAt");
