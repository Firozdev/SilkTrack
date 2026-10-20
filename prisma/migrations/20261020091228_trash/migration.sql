-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "unlinks" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "deletedById" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrashItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrashItem_deletedAt_idx" ON "TrashItem"("deletedAt");

-- AddForeignKey
ALTER TABLE "TrashItem" ADD CONSTRAINT "TrashItem_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
