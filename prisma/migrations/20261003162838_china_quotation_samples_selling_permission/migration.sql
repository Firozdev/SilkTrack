/*
  Warnings:

  - You are about to drop the column `netWeightKg` on the `Estimate` table. All the data in the column will be lost.
  - You are about to drop the column `sampleCostRmb` on the `Estimate` table. All the data in the column will be lost.
  - You are about to drop the column `shippingRatePerCbmBdt` on the `Estimate` table. All the data in the column will be lost.
  - You are about to drop the column `shippingRatePerKgBdt` on the `Estimate` table. All the data in the column will be lost.
  - Added the required column `totalBdt` to the `Estimate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalRmb` to the `Estimate` table without a default value. This is not possible if the table is not empty.
  - Made the column `grossWeightKg` on table `Estimate` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cartonCount` on table `Estimate` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cbm` on table `Estimate` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('REQUESTED', 'INVOICED', 'AWAITING_PAYMENT', 'PAID', 'PURCHASED', 'SHIPPED', 'RECEIVED_BD', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SampleShippingMode" AS ENUM ('WEEKLY_SHIPMENT', 'EXPRESS_COURIER', 'HAND_CARRY', 'POST', 'OTHER');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'SAMPLE';

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "sampleId" TEXT;

-- AlterTable
ALTER TABLE "Estimate" DROP COLUMN "netWeightKg",
DROP COLUMN "sampleCostRmb",
DROP COLUMN "shippingRatePerCbmBdt",
DROP COLUMN "shippingRatePerKgBdt",
ADD COLUMN     "shippingRatePerCbmRmb" DECIMAL(14,2),
ADD COLUMN     "shippingRatePerKgRmb" DECIMAL(14,2),
ADD COLUMN     "shippingRmb" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalBdt" DECIMAL(14,2) NOT NULL,
ADD COLUMN     "totalRmb" DECIMAL(14,2) NOT NULL,
ALTER COLUMN "grossWeightKg" SET NOT NULL,
ALTER COLUMN "grossWeightKg" SET DEFAULT 0,
ALTER COLUMN "cartonCount" SET NOT NULL,
ALTER COLUMN "cartonCount" SET DEFAULT 0,
ALTER COLUMN "cbm" SET NOT NULL,
ALTER COLUMN "cbm" SET DEFAULT 0,
ALTER COLUMN "marginBdt" DROP NOT NULL,
ALTER COLUMN "grandTotalBdt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EstimateLine" ADD COLUMN     "cartonCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cbm" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "heightCm" DECIMAL(8,2),
ADD COLUMN     "lengthCm" DECIMAL(8,2),
ADD COLUMN     "sellingPriceBdt" DECIMAL(14,2),
ADD COLUMN     "unitWeightKg" DECIMAL(10,3),
ADD COLUMN     "weightKg" DECIMAL(10,3) NOT NULL DEFAULT 0,
ADD COLUMN     "widthCm" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "sampleId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canSetSellingPrice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productRmb" DECIMAL(14,2),
    "chinaShippingRmb" DECIMAL(14,2),
    "shippingToBdRmb" DECIMAL(14,2),
    "serviceRmb" DECIMAL(14,2),
    "totalRmb" DECIMAL(14,2),
    "exchangeRateId" TEXT,
    "rateUsed" DECIMAL(12,4),
    "totalBdt" DECIMAL(14,2),
    "paymentRequired" BOOLEAN,
    "invoicedById" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "supplierName" TEXT,
    "supplierOrderNo" TEXT,
    "purchaseTrackingUrl" TEXT,
    "expectedAtWarehouseAt" TIMESTAMP(3),
    "purchasedById" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "shippingMode" "SampleShippingMode",
    "carrierName" TEXT,
    "trackingNo" TEXT,
    "trackingUrl" TEXT,
    "shipmentId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "etaBd" TIMESTAMP(3),
    "receivedBdAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "customerFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleLine" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "SampleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleEvent" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "status" "SampleStatus",
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "SampleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sample_number_key" ON "Sample"("number");

-- CreateIndex
CREATE INDEX "Sample_status_idx" ON "Sample"("status");

-- CreateIndex
CREATE INDEX "Sample_orderId_idx" ON "Sample"("orderId");

-- CreateIndex
CREATE INDEX "SampleEvent_sampleId_occurredAt_idx" ON "SampleEvent"("sampleId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleLine" ADD CONSTRAINT "SampleLine_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleLine" ADD CONSTRAINT "SampleLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleEvent" ADD CONSTRAINT "SampleEvent_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleEvent" ADD CONSTRAINT "SampleEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
