-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('SHIPPING_INVOICE', 'ORDER_INVOICE', 'QUOTE', 'PAYMENT_RECEIPT');

-- AlterTable
ALTER TABLE "ShippingOrder" ADD COLUMN     "invoiceDueDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNotes" TEXT;

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "shippingOrderId" TEXT,
    "invoiceId" TEXT,
    "estimateId" TEXT,
    "paymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedDocument_shippingOrderId_idx" ON "GeneratedDocument"("shippingOrderId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_paymentId_idx" ON "GeneratedDocument"("paymentId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_estimateId_idx" ON "GeneratedDocument"("estimateId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_invoiceId_idx" ON "GeneratedDocument"("invoiceId");

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
