CREATE TABLE "MonitoringConsent" (
  "visitorHash" TEXT NOT NULL PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL,
  "version" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MonitoringConsent_expiresAt_idx" ON "MonitoringConsent"("expiresAt");
CREATE TABLE "MonitoringVisit" (
  "id" TEXT NOT NULL PRIMARY KEY, "visitorHash" TEXT NOT NULL, "userId" TEXT,
  "consentAt" TIMESTAMP(3) NOT NULL, "consentVersion" TEXT NOT NULL,
  "ip" TEXT, "country" TEXT, "browser" TEXT NOT NULL, "device" TEXT NOT NULL,
  "source" TEXT, "searchPhrase" TEXT, "campaign" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "MonitoringPage" (
  "id" TEXT NOT NULL PRIMARY KEY, "visitId" TEXT NOT NULL, "path" TEXT NOT NULL,
  "search" TEXT, "activeSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringPage_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "MonitoringVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MonitoringVisit_createdAt_idx" ON "MonitoringVisit"("createdAt");
CREATE INDEX "MonitoringVisit_visitorHash_createdAt_idx" ON "MonitoringVisit"("visitorHash", "createdAt");
CREATE INDEX "MonitoringVisit_ip_createdAt_idx" ON "MonitoringVisit"("ip", "createdAt");
CREATE INDEX "MonitoringPage_visitId_createdAt_idx" ON "MonitoringPage"("visitId", "createdAt");
