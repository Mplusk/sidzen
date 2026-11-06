ALTER TABLE "Order" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "CdekDeliveryJob" ADD COLUMN "deliveryStatus" TEXT, ADD COLUMN "deliveryStatusChangedAt" TIMESTAMP(3);

-- Existing Ozon status snapshots have already passed the worker's schema and
-- parcel-matching checks. Only complete, fully delivered orders qualify.
UPDATE "Shipment" s SET "deliveredAt" = delivered."deliveredAt"
FROM (
  SELECT j."shipmentId", MAX((p->>'status_changed_at')::timestamptz) AT TIME ZONE 'UTC' AS "deliveredAt"
  FROM "OzonDeliveryJob" j
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j."response"->'statuses') = 'array' THEN j."response"->'statuses' ELSE '[]'::jsonb END) p
  WHERE j."status" = 'FINISHED' AND j."cancelRequestedAt" IS NULL
  GROUP BY j."shipmentId", j."response"
  HAVING bool_and(p->>'status' = 'delivered')
    AND count(*) = jsonb_array_length(CASE WHEN jsonb_typeof(j."response"->'postings') = 'array' THEN j."response"->'postings' ELSE '[]'::jsonb END)
) delivered WHERE s."id" = delivered."shipmentId" AND s."deliveredAt" IS NULL;

-- Historical timestamps are only retained when an audit record is known to
-- be newer than the last order write; older, unverifiable dates stay NULL.
UPDATE "Order" AS o SET "statusChangedAt" = a."createdAt"
FROM LATERAL (
  SELECT l."entityId", l."createdAt", l."after"
  FROM "AuditLog" l
  WHERE l."action" = 'order.status.update'
    AND l."entityType" = 'Order'
    AND l."before"->>'status' IS DISTINCT FROM l."after"->>'status'
) AS a
WHERE a."entityId" = o."id" AND a."after"->>'status' = o."status"::text
  AND a."createdAt" >= o."updatedAt"
  AND NOT EXISTS (SELECT 1 FROM "AuditLog" newer WHERE newer."entityType" = 'Order' AND newer."entityId" = o."id" AND newer."action" = 'order.status.update' AND newer."createdAt" > a."createdAt");

CREATE FUNCTION sidzen_order_status_changed_at() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."statusChangedAt" := COALESCE(NEW."statusChangedAt", NEW."createdAt");
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_status_changed_at BEFORE INSERT OR UPDATE OF "status" ON "Order"
FOR EACH ROW EXECUTE FUNCTION sidzen_order_status_changed_at();

