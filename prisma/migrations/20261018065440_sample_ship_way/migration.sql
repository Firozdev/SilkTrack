-- CreateEnum
CREATE TYPE "SampleShipWay" AS ENUM ('HAND_CARRY', 'AIR', 'SEA');

-- AlterTable
ALTER TABLE "Sample" ADD COLUMN     "shipWay" "SampleShipWay";
