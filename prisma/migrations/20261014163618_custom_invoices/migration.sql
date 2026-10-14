-- CreateTable
CREATE TABLE "CustomInvoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shippingOrderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "logoKey" TEXT,
    "logoMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomInvoice_accountId_shippingOrderId_idx" ON "CustomInvoice"("accountId", "shippingOrderId");

-- AddForeignKey
ALTER TABLE "CustomInvoice" ADD CONSTRAINT "CustomInvoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PortalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomInvoice" ADD CONSTRAINT "CustomInvoice_shippingOrderId_fkey" FOREIGN KEY ("shippingOrderId") REFERENCES "ShippingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
