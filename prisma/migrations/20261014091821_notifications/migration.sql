-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "link" TEXT,
ADD COLUMN     "portalAccountId" TEXT;

-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "notifySound" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifySound" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "orderId" TEXT,
    "shippingOrderId" TEXT,
    "sampleId" TEXT,
    "shipmentId" TEXT,
    "issueId" TEXT,
    "customerId" TEXT,
    "actorUserId" TEXT,
    "actorAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationEvent_orderId_idx" ON "NotificationEvent"("orderId");

-- CreateIndex
CREATE INDEX "NotificationEvent_shippingOrderId_idx" ON "NotificationEvent"("shippingOrderId");

-- CreateIndex
CREATE INDEX "NotificationEvent_sampleId_idx" ON "NotificationEvent"("sampleId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_portalAccountId_readAt_idx" ON "Notification"("portalAccountId", "readAt");

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_portalAccountId_fkey" FOREIGN KEY ("portalAccountId") REFERENCES "PortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
