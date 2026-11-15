ALTER TABLE "Product" ADD COLUMN "ozonDeclaredValue" DECIMAL(12,2);
ALTER TABLE "Product" ADD CONSTRAINT "Product_ozonDeclaredValue_positive" CHECK ("ozonDeclaredValue" IS NULL OR "ozonDeclaredValue" > 0);
