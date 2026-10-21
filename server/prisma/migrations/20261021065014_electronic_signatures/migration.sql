-- AlterTable
ALTER TABLE "DocSignature" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "meaning" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sigHash" TEXT;
