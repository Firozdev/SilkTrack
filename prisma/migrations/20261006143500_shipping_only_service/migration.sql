-- CreateEnum
CREATE TYPE "ShippingOrderStatus" AS ENUM ('REQUESTED', 'RECEIVED_CHINA', 'QA_DONE', 'IN_SHIPMENT', 'RECEIVED_BD', 'INVOICED', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "QaResult" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('STAFF', 'PORTAL');

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'QA_PHOTO';

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'SHIPPING_SERVICE';

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "shippingOrderId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "shippingOrderId" TEXT;

-- CreateTable
CREATE TABLE "ShippingOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'STAFF',
    "createdById" TEXT,
    "status" "ShippingOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "shippingMethod" "ShippingMethod" NOT NULL DEFAULT 'AIR',
    "qaRequested" BOOLEAN NOT NULL DEFAULT false,
    "customerNotes" TEXT,
    "declaredWeightKg" DECIMAL(10,3),
    "declaredCbm" DECIMAL(10,4),
    "receivedChinaAt" TIMESTAMP(3),
    "receivedChinaById" TEXT,
    "cartonCount" INTEGER,
    "cartonMark" TEXT,
    "grossWeightKg" DECIMAL(10,3),
    "cbm" DECIMAL(10,4),
    "qaResult" "QaResult",
    "qaNotes" TEXT,
    "qaById" TEXT,
    "qaAt" TIMESTAMP(3),
    "shipmentId" TEXT,
    "receivedBdAt" TIMESTAMP(3),
    "billWeightKg" DECIMAL(10,3),
    "billCbm" DECIMAL(10,4),
    "shipRatePerKgBdt" DECIMAL(14,2),
    "shipRatePerCbmBdt" DECIMAL(14,2),
    "shippingChargeBdt" DECIMAL(14,2),
    "qaFeeBdt" DECIMAL(14,2),
    "localDeliveryBdt" DECIMAL(14,2),
    "otherChargeBdt" DECIMAL(14,2),
    "discountBdt" DECIMAL(14,2),
    "invoiceTotalBdt" DECIMAL(14,2),
    "exchangeRateId" TEXT,
    "rateUsed" DECIMAL(12,4),
    "invoicedById" TEXT,
    "invoicedAt" TIMESTAMP(3),
    "deliveryCourier" "DeliveryCourier",
    "deliveryTrackingNo" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receiverName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingOrderItem" (
    "id" TEXT NOT NULL,
    "shippingOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "courierName" TEXT,
    "trackingNo" TEXT,
    "quantityReceived" INTEGER,
    "condition" "ReceivingCondition",

    CONSTRAINT "ShippingOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingOrderCarton" (
    "id" TEXT NOT NULL,
    "shippingOrderId" TEXT NOT NULL,
    "lengthCm" DECIMAL(8,2) NOT NULL,
    "widthCm" DECIMAL(8,2) NOT NULL,
    "heightCm" DECIMAL(8,2) NOT NULL,
    "cbm" DECIMAL(10,4) NOT NULL,
    "grossWeightKg" DECIMAL(10,3),

    CONSTRAINT "ShippingOrderCarton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingOrderEvent" (
    "id" TEXT NOT NULL,
    "shippingOrderId" TEXT NOT NULL,
    "status" "ShippingOrderStatus",
    "message" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ShippingOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingOrder_number_key" ON "ShippingOrder"("number");

-- CreateIndex
CREATE INDEX "ShippingOrder_status_idx" ON "ShippingOrder"("status");

-- CreateIndex
CREATE INDEX "ShippingOrder_customerId_idx" ON "ShippingOrder"("customerId");

-- CreateIndex
CREATE INDEX "ShippingOrder_shipmentId_idx" ON "ShippingOrder"("shipmentId");

-- CreateIndex
CREATE INDEX "ShippingOrderItem_trackingNo_idx" ON "ShippingOrderItem"("trackingNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingOrderItem_shippingOrderId_lineNo_key" ON "ShippingOrderItem"("shippingOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "ShippingOrderEvent_shippingOrderId_occurredAt_idx" ON "ShippingOrderEvent"("shippingOrderId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_receivedChinaById_fkey" FOREIGN KEY ("receivedChinaById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_qaById_fkey" FOREIGN KEY ("qaById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrderItem" ADD CONSTRAINT "ShippingOrderItem_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrderCarton" ADD CONSTRAINT "ShippingOrderCarton_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrderEvent" ADD CONSTRAINT "ShippingOrderEvent_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrderEvent" ADD CONSTRAINT "ShippingOrderEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
