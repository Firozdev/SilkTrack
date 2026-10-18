-- DropForeignKey
ALTER TABLE "Sample" DROP CONSTRAINT "Sample_requestedById_fkey";

-- AlterTable
ALTER TABLE "Sample" ADD COLUMN     "requestedByAccountId" TEXT,
ALTER COLUMN "requestedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_requestedByAccountId_fkey" FOREIGN KEY ("requestedByAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
