-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "toCompany" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackByName" TEXT,
    "ackByUserId" TEXT,
    "ackAt" TIMESTAMP(3),
    "ackNote" TEXT,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_projectId_code_key" ON "Transmittal"("projectId", "code");

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
