-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "advanceRequestNote" TEXT,
ADD COLUMN     "advanceRequestedAt" TIMESTAMP(3),
ADD COLUMN     "advanceRequestedById" TEXT;

-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN     "trackingUrl" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_advanceRequestedById_fkey" FOREIGN KEY ("advanceRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
