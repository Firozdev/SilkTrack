-- CreateEnum
CREATE TYPE "PaymentSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "paymentSubmissionId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "customerReportedProblem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sample" ADD COLUMN     "customerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "customerReportedProblem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShippingOrder" ADD COLUMN     "customerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "customerReportedProblem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentSubmission" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT,
    "shippingOrderId" TEXT,
    "sampleId" TEXT,
    "amountBdt" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "PaymentSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSubmission_number_key" ON "PaymentSubmission"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSubmission_paymentId_key" ON "PaymentSubmission"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentSubmission_status_idx" ON "PaymentSubmission"("status");

-- CreateIndex
CREATE INDEX "PaymentSubmission_customerId_idx" ON "PaymentSubmission"("customerId");

-- CreateIndex
CREATE INDEX "PaymentSubmission_reference_idx" ON "PaymentSubmission"("reference");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_paymentSubmissionId_fkey" FOREIGN KEY ("paymentSubmissionId") REFERENCES "PaymentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PortalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
