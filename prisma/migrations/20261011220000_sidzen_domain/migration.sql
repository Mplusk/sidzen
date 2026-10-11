-- Current site configuration only. Never rewrite user identities, historical
-- consent documents, orders, payments or fiscal receipts during a domain move.
UPDATE "SiteSetting"
SET "value" = '"https://sidzen.shop"'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'site.domain';
