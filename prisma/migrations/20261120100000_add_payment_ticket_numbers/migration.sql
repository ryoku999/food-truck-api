CREATE TABLE "payment_ticket_numbers" (
    "key" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    CONSTRAINT "payment_ticket_numbers_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "payment_ticket_numbers_number_key" ON "payment_ticket_numbers"("number");
