-- Requests go to the China team directly: "Sent to China" is merged into "New"
-- (moved first, so no row is left with the removed value).
UPDATE "Order" SET "requestStatus" = 'NEW' WHERE "requestStatus" = 'SENT_TO_CHINA';

-- AlterEnum
BEGIN;
CREATE TYPE "RequestStatus_new" AS ENUM ('NEW', 'SAMPLING', 'QUOTED', 'CUSTOMER_APPROVED', 'REJECTED', 'CANCELLED');
ALTER TABLE "public"."Order" ALTER COLUMN "requestStatus" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "requestStatus" TYPE "RequestStatus_new" USING ("requestStatus"::text::"RequestStatus_new");
ALTER TYPE "RequestStatus" RENAME TO "RequestStatus_old";
ALTER TYPE "RequestStatus_new" RENAME TO "RequestStatus";
DROP TYPE "public"."RequestStatus_old";
ALTER TABLE "Order" ALTER COLUMN "requestStatus" SET DEFAULT 'NEW';
COMMIT;

