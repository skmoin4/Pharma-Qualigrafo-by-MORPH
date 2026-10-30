-- Phase 5 / step 3: formal document revisions, distinct from working versions.
-- Additive only: no existing column changes, so every document keeps its current revision number and history.

ALTER TABLE "Project" ADD COLUMN "suitabilityCodes" JSONB;

CREATE TABLE "DocRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "previousId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Under review',
    "reasonForIssue" TEXT NOT NULL DEFAULT '',
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "suitability" TEXT NOT NULL DEFAULT '',
    "preparedBy" TEXT NOT NULL DEFAULT '',
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedBy" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3),
    "approvedBy" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "checksum" TEXT,
    "fileId" TEXT,
    "transmittalId" TEXT,
    CONSTRAINT "DocRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocRevision_previousId_key" ON "DocRevision"("previousId");
CREATE UNIQUE INDEX "DocRevision_documentId_rev_key" ON "DocRevision"("documentId", "rev");
CREATE INDEX "DocRevision_projectId_idx" ON "DocRevision"("projectId");

ALTER TABLE "DocRevision" ADD CONSTRAINT "DocRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocRevision" ADD CONSTRAINT "DocRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocRevision" ADD CONSTRAINT "DocRevision_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "DocRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
