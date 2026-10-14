-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_uploadedById_fkey";

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "uploadedByAccountId" TEXT,
ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "decidedInPortal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'EN';

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByAccountId_fkey" FOREIGN KEY ("uploadedByAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
