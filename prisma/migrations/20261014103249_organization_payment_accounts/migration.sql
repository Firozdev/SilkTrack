-- CreateEnum
CREATE TYPE "PaymentAccountType" AS ENUM ('BANK', 'MOBILE_BANKING', 'OTHER');

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "type" "PaymentAccountType" NOT NULL,
    "providerName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "branch" TEXT,
    "routingNumber" TEXT,
    "notes" TEXT,
    "showOnPdf" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAccount_sortOrder_idx" ON "PaymentAccount"("sortOrder");

-- Starting organization details, so existing PDFs look the same until Admin edits them in Settings.
INSERT INTO "Setting" ("key", "value", "description", "updatedAt")
VALUES ('organization', '{"name":"SilkTrack","tagline":"China sourcing & shipping to your door","phone":"","email":"","website":"","address":"","logo":null}'::jsonb, 'Organization details for PDFs', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
