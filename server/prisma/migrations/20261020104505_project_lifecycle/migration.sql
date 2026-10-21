-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedReason" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'Active';
