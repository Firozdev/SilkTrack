-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "sampleLineId" TEXT,
ADD COLUMN     "shippingOrderItemId" TEXT;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_shippingOrderItemId_fkey" FOREIGN KEY ("shippingOrderItemId") REFERENCES "ShippingOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_sampleLineId_fkey" FOREIGN KEY ("sampleLineId") REFERENCES "SampleLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
