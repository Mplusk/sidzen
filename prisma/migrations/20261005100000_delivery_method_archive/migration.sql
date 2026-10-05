-- Keep a tombstone so deployment seeding cannot recreate a removed default method.
-- Existing shipments have independent provider/method snapshots and are unchanged.
ALTER TABLE "DeliveryMethod" ADD COLUMN "deletedAt" TIMESTAMP(3);
