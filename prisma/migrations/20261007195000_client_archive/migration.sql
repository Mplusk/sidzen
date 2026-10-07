CREATE TABLE "ClientArchive" (
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientArchive_pkey" PRIMARY KEY ("key")
);
