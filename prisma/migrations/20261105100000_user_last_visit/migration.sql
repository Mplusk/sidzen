-- Existing activity timestamps also contain account creation and migration dates.
-- Only surviving sessions provide reliable evidence of a previous sign-in.
ALTER TABLE "User" ADD COLUMN "lastVisitedAt" TIMESTAMP(3);

UPDATE "User" AS u
SET "lastVisitedAt" = s."lastSignIn"
FROM (
  SELECT "userId", MAX("createdAt") AS "lastSignIn"
  FROM "Session"
  GROUP BY "userId"
) AS s
WHERE u."id" = s."userId";
