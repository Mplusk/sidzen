ALTER TABLE "Session" ADD COLUMN "adminVerifiedAt" TIMESTAMP(3);
CREATE TABLE "AdminLoginChallenge" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordFingerprint" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'login',
    "sessionHash" TEXT,
    "smtpRevision" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminLoginChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminLoginChallenge_tokenHash_key" ON "AdminLoginChallenge"("tokenHash");
CREATE INDEX "AdminLoginChallenge_userId_createdAt_idx" ON "AdminLoginChallenge"("userId", "createdAt");
CREATE INDEX "AdminLoginChallenge_expiresAt_idx" ON "AdminLoginChallenge"("expiresAt");
ALTER TABLE "AdminLoginChallenge" ADD CONSTRAINT "AdminLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

