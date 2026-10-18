-- Retire personal analytics rather than reusing its event history.
BEGIN;
SELECT pg_advisory_xact_lock(73412040);
INSERT INTO "AuditLog" ("id", "action", "entityType", "after", "createdAt")
SELECT 'monitoring-retired-20261018', 'monitoring.retire', 'MonitoringVisit',
  jsonb_build_object('visitsRemoved', (SELECT count(*) FROM "MonitoringVisit"), 'pagesRemoved', (SELECT count(*) FROM "MonitoringPage"), 'consentsRemoved', (SELECT count(*) FROM "MonitoringConsent")), CURRENT_TIMESTAMP;
-- Keep empty legacy tables for a safe application rollback, but forbid writes
-- at database level too. An old worker/tab cannot resurrect personal tracking.
DELETE FROM "MonitoringPage";
DELETE FROM "MonitoringVisit";
DELETE FROM "MonitoringConsent";
CREATE FUNCTION monitoring_retired_no_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Personal monitoring is retired' USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER monitoring_retired BEFORE INSERT OR UPDATE ON "MonitoringPage" FOR EACH ROW EXECUTE FUNCTION monitoring_retired_no_writes();
CREATE TRIGGER monitoring_retired BEFORE INSERT OR UPDATE ON "MonitoringVisit" FOR EACH ROW EXECUTE FUNCTION monitoring_retired_no_writes();
CREATE TRIGGER monitoring_retired BEFORE INSERT OR UPDATE ON "MonitoringConsent" FOR EACH ROW EXECUTE FUNCTION monitoring_retired_no_writes();
CREATE TABLE "MonitoringCounter" (
  "day" DATE NOT NULL, "path" TEXT NOT NULL, "productId" TEXT, "views" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "MonitoringCounter_pkey" PRIMARY KEY ("day", "path")
);
CREATE INDEX "MonitoringCounter_day_idx" ON "MonitoringCounter"("day");
COMMIT;
