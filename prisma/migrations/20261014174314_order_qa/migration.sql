-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "qaAt" TIMESTAMP(3),
ADD COLUMN     "qaById" TEXT,
ADD COLUMN     "qaNotes" TEXT,
ADD COLUMN     "qaRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qaResult" "QaResult";

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_qaById_fkey" FOREIGN KEY ("qaById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
