BEGIN;

ALTER TABLE "payments" ADD COLUMN "cashSessionId" UUID;

UPDATE "payments" AS payment
SET "cashSessionId" = movement."cashSessionId"
FROM "cash_movements" AS movement
WHERE movement."paymentId" = payment."id";

CREATE INDEX "payments_cashSessionId_idx" ON "payments"("cashSessionId");
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashSessionId_fkey"
    FOREIGN KEY ("cashSessionId") REFERENCES "cash_register_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
