-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestId" TEXT,
    "lastUser" TEXT,
    "status" TEXT NOT NULL DEFAULT 'New',
    "note" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobHeartbeat" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,

    CONSTRAINT "JobHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Outage" (
    "id" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "noticedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Outage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorEvent_fingerprint_key" ON "ErrorEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_lastAt_idx" ON "ErrorEvent"("lastAt");

-- CreateIndex
CREATE INDEX "Outage_from_idx" ON "Outage"("from");
