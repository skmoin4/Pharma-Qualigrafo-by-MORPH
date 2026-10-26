-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "slot" TEXT,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Running',
    "sizeBytes" BIGINT,
    "files" INTEGER NOT NULL DEFAULT 0,
    "manifestSha" TEXT,
    "error" TEXT,
    "verifyStatus" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifyDetail" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupRun_name_key" ON "BackupRun"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BackupRun_slot_key" ON "BackupRun"("slot");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");
