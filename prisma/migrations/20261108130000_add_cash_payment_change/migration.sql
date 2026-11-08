ALTER TABLE "payments"
  ADD COLUMN "receivedAmount" DECIMAL(10,2),
  ADD COLUMN "changeAmount" DECIMAL(10,2),
  ADD CONSTRAINT "payments_cash_change_check" CHECK (
    ("receivedAmount" IS NULL AND "changeAmount" IS NULL)
    OR ("receivedAmount" IS NOT NULL AND "changeAmount" IS NOT NULL
        AND "changeAmount" >= 0 AND "receivedAmount" = "amount" + "changeAmount")
  );
