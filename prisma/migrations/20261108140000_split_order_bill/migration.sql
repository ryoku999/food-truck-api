ALTER TYPE "PrintJobType" ADD VALUE 'PAYMENT_RECEIPT';
ALTER TYPE "PrintJobType" ADD VALUE 'PART_TICKET';

CREATE TABLE "bill_parts" (
  "id" UUID PRIMARY KEY,
  "orderId" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "total" DECIMAL(10,2) NOT NULL CHECK ("total" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "bill_parts_orderId_idx" ON "bill_parts"("orderId");

CREATE TABLE "bill_part_items" (
  "billPartId" UUID NOT NULL REFERENCES "bill_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderItemId" UUID NOT NULL REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "amount" DECIMAL(10,2) NOT NULL CHECK ("amount" >= 0),
  PRIMARY KEY ("billPartId", "orderItemId")
);
CREATE INDEX "bill_part_items_orderItemId_idx" ON "bill_part_items"("orderItemId");

ALTER TABLE "payments" ADD COLUMN "billPartId" UUID REFERENCES "bill_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "pendingAfter" DECIMAL(10,2);
CREATE INDEX "payments_billPartId_idx" ON "payments"("billPartId");

ALTER TABLE "print_jobs" ADD COLUMN "documentKey" TEXT;
CREATE UNIQUE INDEX "print_jobs_documentKey_key" ON "print_jobs"("documentKey");
