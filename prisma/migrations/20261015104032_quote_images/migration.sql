-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'QUOTE_IMAGE';

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "estimateId" TEXT,
ADD COLUMN     "estimateOrderLineId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_estimateId_idx" ON "Attachment"("estimateId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
