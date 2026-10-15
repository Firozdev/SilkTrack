-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'CUSTOMS_CLEARED';
ALTER TYPE "OrderStatus" ADD VALUE 'INVOICE_SHARED';
ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_COLLECTED';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_DELIVERY';
