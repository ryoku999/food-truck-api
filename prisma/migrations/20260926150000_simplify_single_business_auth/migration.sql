-- Rename the existing role type and column so existing role values are preserved.
ALTER TYPE "RoleCode" RENAME TO "UserRole";
ALTER TABLE "users" RENAME COLUMN "role" TO "userRole";

-- Remove tenant foreign keys.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_businessId_fkey";
ALTER TABLE "cash_registers" DROP CONSTRAINT "cash_registers_businessId_fkey";
ALTER TABLE "categories" DROP CONSTRAINT "categories_businessId_fkey";
ALTER TABLE "dining_areas" DROP CONSTRAINT "dining_areas_businessId_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_businessId_fkey";
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_businessId_fkey";
ALTER TABLE "printer_agents" DROP CONSTRAINT "printer_agents_businessId_fkey";
ALTER TABLE "printers" DROP CONSTRAINT "printers_businessId_fkey";
ALTER TABLE "production_areas" DROP CONSTRAINT "production_areas_businessId_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_businessId_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_businessId_fkey";

-- Remove tenant-aware indexes and unique constraints.
DROP INDEX "audit_logs_businessId_createdAt_idx";
DROP INDEX "cash_registers_businessId_name_key";
DROP INDEX "categories_businessId_active_idx";
DROP INDEX "categories_businessId_name_key";
DROP INDEX "dining_areas_businessId_active_idx";
DROP INDEX "dining_areas_businessId_name_key";
DROP INDEX "orders_businessId_number_key";
DROP INDEX "orders_businessId_openedAt_idx";
DROP INDEX "orders_businessId_status_idx";
DROP INDEX "payment_methods_businessId_code_key";
DROP INDEX "printer_agents_businessId_active_idx";
DROP INDEX "printers_businessId_purpose_idx";
DROP INDEX "production_areas_businessId_code_idx";
DROP INDEX "production_areas_businessId_name_key";
DROP INDEX "products_businessId_active_available_idx";
DROP INDEX "products_businessId_categoryId_idx";
DROP INDEX "users_businessId_role_idx";
DROP INDEX "users_businessId_username_key";

-- Convert all tenant-owned records into records for the single installation.
ALTER TABLE "audit_logs" DROP COLUMN "businessId";
ALTER TABLE "cash_registers" DROP COLUMN "businessId";
ALTER TABLE "categories" DROP COLUMN "businessId";
ALTER TABLE "dining_areas" DROP COLUMN "businessId";
ALTER TABLE "orders" DROP COLUMN "businessId";
ALTER TABLE "payment_methods" DROP COLUMN "businessId";
ALTER TABLE "printer_agents" DROP COLUMN "businessId";
ALTER TABLE "printers" DROP COLUMN "businessId";
ALTER TABLE "production_areas" DROP COLUMN "businessId";
ALTER TABLE "products" DROP COLUMN "businessId";
ALTER TABLE "users" DROP COLUMN "businessId", ADD COLUMN "dni" VARCHAR(8) NOT NULL;

-- Recreate global indexes and unique constraints for the single business.
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE UNIQUE INDEX "cash_registers_name_key" ON "cash_registers"("name");
CREATE INDEX "categories_active_idx" ON "categories"("active");
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE INDEX "dining_areas_active_idx" ON "dining_areas"("active");
CREATE UNIQUE INDEX "dining_areas_name_key" ON "dining_areas"("name");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_openedAt_idx" ON "orders"("openedAt");
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");
CREATE INDEX "printer_agents_active_idx" ON "printer_agents"("active");
CREATE INDEX "printers_purpose_idx" ON "printers"("purpose");
CREATE INDEX "production_areas_code_idx" ON "production_areas"("code");
CREATE UNIQUE INDEX "production_areas_name_key" ON "production_areas"("name");
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");
CREATE INDEX "products_active_available_idx" ON "products"("active", "available");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_dni_key" ON "users"("dni");
CREATE INDEX "users_userRole_idx" ON "users"("userRole");
