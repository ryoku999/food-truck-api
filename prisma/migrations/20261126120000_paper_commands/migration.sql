BEGIN;

-- Preserve historical user references and revoke former production accounts.
DELETE FROM "refresh_tokens" AS token
USING "users" AS account
WHERE token."userId" = account."id" AND account."userRole" IN ('KITCHEN', 'BAR');

UPDATE "users"
SET "status" = 'INACTIVE', "updatedAt" = CURRENT_TIMESTAMP
WHERE "userRole" IN ('KITCHEN', 'BAR');

CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'CASHIER', 'WAITER');
ALTER TABLE "users" ALTER COLUMN "userRole" TYPE "UserRole_new"
USING (CASE WHEN "userRole" IN ('KITCHEN', 'BAR') THEN 'WAITER' ELSE "userRole"::text END)::"UserRole_new";
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

CREATE TYPE "OrderStatus_new" AS ENUM ('DRAFT', 'SENT', 'PAID', 'CANCELLED');
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus_new"
USING (CASE WHEN "status" IN ('IN_PROGRESS', 'READY', 'SERVED') THEN 'SENT' ELSE "status"::text END)::"OrderStatus_new";
DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE TYPE "OrderItemStatus_new" AS ENUM ('DRAFT', 'SENT', 'CANCELLED');
DROP INDEX "order_items_productionArea_status_idx";
ALTER TABLE "order_items" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "order_items" ALTER COLUMN "status" TYPE "OrderItemStatus_new"
USING (CASE WHEN "status" IN ('PENDING', 'PREPARING', 'READY', 'SERVED') THEN 'SENT' ELSE "status"::text END)::"OrderItemStatus_new";
DROP TYPE "OrderItemStatus";
ALTER TYPE "OrderItemStatus_new" RENAME TO "OrderItemStatus";
ALTER TABLE "order_items" ALTER COLUMN "status" SET DEFAULT 'DRAFT',
DROP COLUMN "preparingAt", DROP COLUMN "readyAt", DROP COLUMN "servedAt";

COMMIT;
