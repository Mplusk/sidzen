-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('READY', 'PARAMETRIC', 'PRINT_TEMPLATE');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'HIDDEN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ModelFileStatus" AS ENUM ('UPLOADED', 'ANALYZED', 'NEEDS_REVIEW', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ESTIMATING', 'APPROVED', 'AWAITING_PAYMENT', 'PAID', 'QUEUED', 'PRINTING', 'POST_PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'CANCELED', 'REFUNDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "taxId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorKey" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "apartment" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "descriptionTop" TEXT,
    "description" TEXT,
    "image" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "robots" TEXT NOT NULL DEFAULT 'index,follow',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "type" "ProductType" NOT NULL DEFAULT 'READY',
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "badge" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "usage" TEXT,
    "instructions" TEXT,
    "specifications" JSONB,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "costPrice" DECIMAL(12,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "madeToOrder" BOOLEAN NOT NULL DEFAULT true,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "weightGrams" DECIMAL(12,3),
    "widthMm" DECIMAL(12,3),
    "heightMm" DECIMAL(12,3),
    "depthMm" DECIMAL(12,3),
    "modelAsset" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "robots" TEXT NOT NULL DEFAULT 'index,follow',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "density" DECIMAL(8,4) NOT NULL,
    "pricePerGram" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "advantages" TEXT,
    "disadvantages" TEXT,
    "temperature" TEXT,
    "image" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Color" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "image" TEXT,
    "stock" DECIMAL(12,2),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technology" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "accuracy" TEXT,
    "applications" TEXT,
    "image" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "layerHeightMm" DECIMAL(5,3) NOT NULL,
    "speedMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "priceMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QualityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostProcessOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PostProcessOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "materialId" TEXT,
    "colorId" TEXT,
    "qualityProfileId" TEXT,
    "sku" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerModelFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "guestKey" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "widthMm" DECIMAL(12,3),
    "heightMm" DECIMAL(12,3),
    "depthMm" DECIMAL(12,3),
    "volumeCm3" DECIMAL(14,4),
    "watertight" BOOLEAN,
    "status" "ModelFileStatus" NOT NULL DEFAULT 'UPLOADED',
    "analysisNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerModelFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "modelFileId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "company" TEXT,
    "shippingAddress" TEXT,
    "customerComment" TEXT,
    "internalNote" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "deliveryPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "modelFileId" TEXT,
    "materialId" TEXT,
    "colorId" TEXT,
    "technologyId" TEXT,
    "qualityProfileId" TEXT,
    "productName" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "configuration" JSONB,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "payload" JSONB,
    "paidAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "tracking" TEXT,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payload" JSONB,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderNotification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "OrderNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "cover" TEXT,
    "authorName" TEXT,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "robots" TEXT NOT NULL DEFAULT 'index,follow',
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqItem" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'general',
    "scopeId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoPage" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "canonical" TEXT,
    "robots" TEXT NOT NULL DEFAULT 'index,follow',
    "ogImage" TEXT,
    "schemaTypes" TEXT[],
    "content" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoFilter" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "content" TEXT,
    "canonical" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SeoFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redirect" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "code" INTEGER NOT NULL DEFAULT 301,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "h1" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "rating" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFavorite" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFavorite_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "DeliveryMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductToTechnology" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductToTechnology_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProductToQualityProfile" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductToQualityProfile_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_MaterialToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MaterialToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ColorToMaterial" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ColorToMaterial_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ColorToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ColorToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PostProcessOptionToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PostProcessOptionToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_status_publishedAt_idx" ON "Product"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Product_basePrice_idx" ON "Product"("basePrice");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Material_slug_key" ON "Material"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Color_slug_key" ON "Color"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Technology_slug_key" ON "Technology"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "QualityProfile_slug_key" ON "QualityProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PostProcessOption_slug_key" ON "PostProcessOption"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_active_idx" ON "ProductVariant"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerModelFile_storedName_key" ON "CustomerModelFile"("storedName");

-- CreateIndex
CREATE INDEX "CustomerModelFile_ownerId_createdAt_idx" ON "CustomerModelFile"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerModelFile_guestKey_createdAt_idx" ON "CustomerModelFile"("guestKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerModelFile_ownerId_sha256_key" ON "CustomerModelFile"("ownerId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRule_code_key" ON "PriceRule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_sessionKey_key" ON "Cart"("sessionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_slug_key" ON "Rubric"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "FaqItem_scope_scopeId_active_idx" ON "FaqItem"("scope", "scopeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SeoPage_path_key" ON "SeoPage"("path");

-- CreateIndex
CREATE UNIQUE INDEX "SeoFilter_categoryId_slug_key" ON "SeoFilter"("categoryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Redirect_fromPath_key" ON "Redirect"("fromPath");

-- CreateIndex
CREATE UNIQUE INDEX "MetaTemplate_code_key" ON "MetaTemplate"("code");

-- CreateIndex
CREATE INDEX "Review_productId_approved_createdAt_idx" ON "Review"("productId", "approved", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryMethod_code_key" ON "DeliveryMethod"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "_ProductToTechnology_B_index" ON "_ProductToTechnology"("B");

-- CreateIndex
CREATE INDEX "_ProductToQualityProfile_B_index" ON "_ProductToQualityProfile"("B");

-- CreateIndex
CREATE INDEX "_MaterialToProduct_B_index" ON "_MaterialToProduct"("B");

-- CreateIndex
CREATE INDEX "_ColorToMaterial_B_index" ON "_ColorToMaterial"("B");

-- CreateIndex
CREATE INDEX "_ColorToProduct_B_index" ON "_ColorToProduct"("B");

-- CreateIndex
CREATE INDEX "_PostProcessOptionToProduct_B_index" ON "_PostProcessOptionToProduct"("B");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_qualityProfileId_fkey" FOREIGN KEY ("qualityProfileId") REFERENCES "QualityProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerModelFile" ADD CONSTRAINT "CustomerModelFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_modelFileId_fkey" FOREIGN KEY ("modelFileId") REFERENCES "CustomerModelFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_modelFileId_fkey" FOREIGN KEY ("modelFileId") REFERENCES "CustomerModelFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "Technology"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qualityProfileId_fkey" FOREIGN KEY ("qualityProfileId") REFERENCES "QualityProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNotification" ADD CONSTRAINT "OrderNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoFilter" ADD CONSTRAINT "SeoFilter_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFavorite" ADD CONSTRAINT "ProductFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFavorite" ADD CONSTRAINT "ProductFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToTechnology" ADD CONSTRAINT "_ProductToTechnology_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToTechnology" ADD CONSTRAINT "_ProductToTechnology_B_fkey" FOREIGN KEY ("B") REFERENCES "Technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToQualityProfile" ADD CONSTRAINT "_ProductToQualityProfile_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductToQualityProfile" ADD CONSTRAINT "_ProductToQualityProfile_B_fkey" FOREIGN KEY ("B") REFERENCES "QualityProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialToProduct" ADD CONSTRAINT "_MaterialToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaterialToProduct" ADD CONSTRAINT "_MaterialToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToMaterial" ADD CONSTRAINT "_ColorToMaterial_A_fkey" FOREIGN KEY ("A") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToMaterial" ADD CONSTRAINT "_ColorToMaterial_B_fkey" FOREIGN KEY ("B") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToProduct" ADD CONSTRAINT "_ColorToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "Color"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColorToProduct" ADD CONSTRAINT "_ColorToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostProcessOptionToProduct" ADD CONSTRAINT "_PostProcessOptionToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "PostProcessOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PostProcessOptionToProduct" ADD CONSTRAINT "_PostProcessOptionToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
