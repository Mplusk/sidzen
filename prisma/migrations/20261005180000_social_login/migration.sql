CREATE TABLE "SocialAccount" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "clientId" TEXT NOT NULL, "subject" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialAccount_provider_clientId_subject_key" ON "SocialAccount"("provider", "clientId", "subject");
CREATE UNIQUE INDEX "SocialAccount_userId_provider_clientId_key" ON "SocialAccount"("userId", "provider", "clientId");
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "OAuthAttempt" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "stateHash" TEXT NOT NULL, "bindingHash" TEXT NOT NULL,
  "configRevision" TEXT NOT NULL, "verifier" TEXT NOT NULL, "nonce" TEXT NOT NULL, "returnTo" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'STARTED', "profile" TEXT, "consent" JSONB NOT NULL,
  "linkUserId" TEXT, "sessionHash" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthAttempt_stateHash_key" ON "OAuthAttempt"("stateHash");
CREATE UNIQUE INDEX "OAuthAttempt_bindingHash_key" ON "OAuthAttempt"("bindingHash");
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
ALTER TABLE "OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_linkUserId_fkey" FOREIGN KEY ("linkUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
