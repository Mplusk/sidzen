CREATE TABLE "DiagnosticLog" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosticLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiagnosticLog_reference_key" ON "DiagnosticLog"("reference");
CREATE INDEX "DiagnosticLog_createdAt_id_idx" ON "DiagnosticLog"("createdAt", "id");
CREATE INDEX "DiagnosticLog_area_level_createdAt_idx" ON "DiagnosticLog"("area", "level", "createdAt");
