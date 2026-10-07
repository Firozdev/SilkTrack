-- AlterTable
ALTER TABLE "ShippingOrder" ADD COLUMN     "shippingRateId" TEXT;

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" TEXT NOT NULL,
    "airPerKgBdt" DECIMAL(14,2),
    "seaPerCbmBdt" DECIMAL(14,2),
    "qaFeeBdt" DECIMAL(14,2),
    "localDeliveryBdt" DECIMAL(14,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRate_effectiveFrom_key" ON "ShippingRate"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingOrder" ADD CONSTRAINT "ShippingOrder_shippingRateId_fkey" FOREIGN KEY ("shippingRateId") REFERENCES "ShippingRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: the rates set in Settings become the first rate record, live from now.
INSERT INTO "ShippingRate" ("id", "airPerKgBdt", "seaPerCbmBdt", "qaFeeBdt", "localDeliveryBdt", "effectiveFrom", "note")
SELECT 'rate-from-settings',
       NULLIF(air.v, '')::numeric, NULLIF(sea.v, '')::numeric, NULLIF(qa.v, '')::numeric,
       COALESCE(NULLIF(del.v, ''), '120')::numeric, now(), 'Copied from Settings'
FROM (SELECT (SELECT "value" #>> '{}' FROM "Setting" WHERE "key" = 'shipping_service_air_per_kg_bdt') AS v) air,
     (SELECT (SELECT "value" #>> '{}' FROM "Setting" WHERE "key" = 'shipping_service_sea_per_cbm_bdt') AS v) sea,
     (SELECT (SELECT "value" #>> '{}' FROM "Setting" WHERE "key" = 'shipping_service_qa_fee_bdt') AS v) qa,
     (SELECT (SELECT "value" #>> '{}' FROM "Setting" WHERE "key" = 'default_local_delivery_bdt') AS v) del
WHERE COALESCE(air.v, '') <> '' OR COALESCE(sea.v, '') <> '';
