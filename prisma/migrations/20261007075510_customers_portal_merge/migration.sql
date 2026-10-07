-- AlterEnum
ALTER TYPE "PortalAccountStatus" ADD VALUE 'INVITED';

-- AlterEnum
ALTER TYPE "PortalTokenPurpose" ADD VALUE 'INVITE';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "PortalAccount" ADD COLUMN     "invitedAt" TIMESTAMP(3),
ADD COLUMN     "invitedById" TEXT;

-- AddForeignKey
ALTER TABLE "PortalAccount" ADD CONSTRAINT "PortalAccount_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: customers created from a portal sign-up (created after the sign-up itself).
UPDATE "Customer" c SET "source" = 'PORTAL'
WHERE EXISTS (SELECT 1 FROM "PortalAccount" a WHERE a."customerId" = c."id" AND c."createdAt" >= a."createdAt");
