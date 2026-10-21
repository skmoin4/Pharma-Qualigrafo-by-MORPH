-- AlterTable
ALTER TABLE "RegUpdate" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'Regulatory',
ADD COLUMN     "libraryVersionId" TEXT;

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "libraryKey" TEXT,
ADD COLUMN     "libraryVersionId" TEXT;

-- CreateTable
CREATE TABLE "LibraryPack" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryVersion" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "note" TEXT NOT NULL DEFAULT '',
    "starter" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalReason" TEXT,

    CONSTRAINT "LibraryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "discipline" TEXT NOT NULL,
    "facilities" JSONB NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "clause" TEXT NOT NULL DEFAULT '',
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "effective" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryPack_market_key" ON "LibraryPack"("market");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryVersion_packId_version_key" ON "LibraryVersion"("packId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryItem_versionId_key_key" ON "LibraryItem"("versionId", "key");

-- AddForeignKey
ALTER TABLE "LibraryVersion" ADD CONSTRAINT "LibraryVersion_packId_fkey" FOREIGN KEY ("packId") REFERENCES "LibraryPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LibraryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
