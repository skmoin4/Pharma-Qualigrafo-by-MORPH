-- AlterTable
ALTER TABLE "Pin" ADD COLUMN     "anchored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "page" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ConnectorToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectorToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevitModel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSnapshotAt" TIMESTAMP(3),

    CONSTRAINT "RevitModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT NOT NULL,
    "elementCount" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB NOT NULL,

    CONSTRAINT "ModelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavigationRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "modelGuid" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "detail" TEXT,
    "requestedByUserId" TEXT,
    "requestedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavigationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorToken_tokenHash_key" ON "ConnectorToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RevitModel_projectId_guid_key" ON "RevitModel"("projectId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "ModelSnapshot_modelId_version_key" ON "ModelSnapshot"("modelId", "version");

-- CreateIndex
CREATE INDEX "NavigationRequest_projectId_status_idx" ON "NavigationRequest"("projectId", "status");

-- AddForeignKey
ALTER TABLE "ConnectorToken" ADD CONSTRAINT "ConnectorToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevitModel" ADD CONSTRAINT "RevitModel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelSnapshot" ADD CONSTRAINT "ModelSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelSnapshot" ADD CONSTRAINT "ModelSnapshot_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "RevitModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationRequest" ADD CONSTRAINT "NavigationRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationRequest" ADD CONSTRAINT "NavigationRequest_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
