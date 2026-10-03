-- Stand-alone samples: a sample may exist without a request.
-- New columns are added nullable, back-filled from the linked request, then made required.

-- DropForeignKey
ALTER TABLE "Sample" DROP CONSTRAINT "Sample_orderId_fkey";

-- DropForeignKey
ALTER TABLE "SampleLine" DROP CONSTRAINT "SampleLine_orderLineId_fkey";

-- Sample: customer (copied from the request), request optional
ALTER TABLE "Sample" ADD COLUMN "customerId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

UPDATE "Sample" s SET "customerId" = o."customerId" FROM "Order" o WHERE o."id" = s."orderId";

ALTER TABLE "Sample" ALTER COLUMN "customerId" SET NOT NULL;

-- SampleLine: own product details (copied from the request line), request line optional
ALTER TABLE "SampleLine" ADD COLUMN "link" TEXT,
ADD COLUMN "productName" TEXT,
ADD COLUMN "variant" TEXT,
ALTER COLUMN "orderLineId" DROP NOT NULL;

UPDATE "SampleLine" sl
SET "productName" = ol."productName",
    "variant" = NULLIF(CONCAT_WS(' · ', ol."color", ol."size", ol."model"), '')
FROM "OrderLine" ol
WHERE ol."id" = sl."orderLineId";

ALTER TABLE "SampleLine" ALTER COLUMN "productName" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleLine" ADD CONSTRAINT "SampleLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
