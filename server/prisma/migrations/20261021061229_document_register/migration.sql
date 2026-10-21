-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "statusBeforeVoid" TEXT,
ADD COLUMN     "supersededBy" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedBy" TEXT;
