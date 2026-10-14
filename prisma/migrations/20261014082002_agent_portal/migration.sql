-- CreateEnum
CREATE TYPE "PortalAccountKind" AS ENUM ('CUSTOMER', 'AGENT');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "agentAccountId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "placedByAccountId" TEXT;

-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "kind" "PortalAccountKind" NOT NULL DEFAULT 'CUSTOMER';

-- AlterTable
ALTER TABLE "ShippingOrder" ADD COLUMN     "placedByAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Customer_agentAccountId_idx" ON "Customer"("agentAccountId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_agentAccountId_fkey" FOREIGN KEY ("agentAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_placedByAccountId_fkey" FOREIGN KEY ("placedByAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_placedByAccountId_fkey" FOREIGN KEY ("placedByAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
