-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "facility" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "plantCountry" TEXT NOT NULL,
    "ownerStandards" TEXT NOT NULL,
    "markets" JSONB NOT NULL,
    "baseline" INTEGER NOT NULL DEFAULT 1,
    "revitMode" BOOLEAN NOT NULL DEFAULT false,
    "autoRouting" BOOLEAN NOT NULL DEFAULT true,
    "autoReminders" BOOLEAN NOT NULL DEFAULT true,
    "autoIssue" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Baseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "v" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "Baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "signStage" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSignature" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rev" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "DocSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocHistory" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "note" TEXT,

    CONSTRAINT "DocHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "applicability" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "clause" TEXT NOT NULL DEFAULT '',
    "sourceVersion" TEXT NOT NULL DEFAULT '',
    "effective" TEXT NOT NULL DEFAULT '',
    "sourceAttested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "rev" INTEGER NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'Pending',
    "note" TEXT NOT NULL,
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedByUserId" TEXT,
    "reason" TEXT,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pin" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "room" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "model" TEXT,
    "element" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PinReply" (
    "id" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reqs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Awaiting assessment',
    "reason" TEXT,

    CONSTRAINT "RegUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GapAction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GapAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Awaiting response',
    "raisedBy" TEXT NOT NULL,
    "raisedByUserId" TEXT,
    "due" DATE NOT NULL,
    "response" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "evidence" TEXT NOT NULL DEFAULT 'Not yet submitted',
    "drawingRev" TEXT NOT NULL DEFAULT '—',
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "source" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "disposition" TEXT,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Change" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Impact review',
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeItem" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'Unassessed',

    CONSTRAINT "ChangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "system" TEXT NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,
    "due" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ncr" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "documentId" TEXT,
    "requirementId" TEXT,
    "raisedBy" TEXT NOT NULL,
    "raisedByUserId" TEXT,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "rootCause" TEXT,
    "containment" TEXT,
    "correctiveAction" TEXT,
    "respondedBy" TEXT,
    "closedBy" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "Ncr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fromRev" INTEGER NOT NULL,
    "toRev" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cancelledRoute" BOOLEAN NOT NULL,
    "byUserId" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedPackage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "signers" JSONB NOT NULL,
    "checksum" TEXT,

    CONSTRAINT "IssuedPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byRole" TEXT NOT NULL,
    "byUserId" TEXT,
    "baseline" INTEGER NOT NULL,
    "markets" JSONB NOT NULL,
    "required" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "blockers" JSONB NOT NULL,
    "rows" JSONB NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "text" TEXT NOT NULL,
    "requestId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "docCode" TEXT,
    "forRole" TEXT,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeRead" (
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeRead_pkey" PRIMARY KEY ("noticeId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_projectId_idx" ON "Membership"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Baseline_projectId_v_key" ON "Baseline"("projectId", "v");

-- CreateIndex
CREATE UNIQUE INDEX "Document_projectId_code_key" ON "Document"("projectId", "code");

-- CreateIndex
CREATE INDEX "DocSignature_documentId_idx" ON "DocSignature"("documentId");

-- CreateIndex
CREATE INDEX "DocHistory_documentId_idx" ON "DocHistory"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_code_key" ON "Requirement"("projectId", "code");

-- CreateIndex
CREATE INDEX "EvidenceLink_documentId_idx" ON "EvidenceLink"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLink_requirementId_documentId_rev_key" ON "EvidenceLink"("requirementId", "documentId", "rev");

-- CreateIndex
CREATE UNIQUE INDEX "Pin_projectId_code_key" ON "Pin"("projectId", "code");

-- CreateIndex
CREATE INDEX "PinReply_pinId_idx" ON "PinReply"("pinId");

-- CreateIndex
CREATE UNIQUE INDEX "RegUpdate_projectId_code_key" ON "RegUpdate"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GapAction_projectId_code_key" ON "GapAction"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_projectId_code_key" ON "Rfi"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_projectId_code_key" ON "Inspection"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_projectId_code_key" ON "Finding"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Change_projectId_code_key" ON "Change"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeItem_changeId_ref_key" ON "ChangeItem"("changeId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_projectId_code_key" ON "Risk"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Ncr_projectId_code_key" ON "Ncr"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_projectId_code_key" ON "ImportBatch"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_documentId_checksum_key" ON "ImportBatch"("documentId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedPackage_projectId_code_key" ON "IssuedPackage"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_projectId_code_key" ON "Snapshot"("projectId", "code");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_at_idx" ON "AuditEvent"("projectId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_projectId_seq_key" ON "Notice"("projectId", "seq");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Baseline" ADD CONSTRAINT "Baseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSignature" ADD CONSTRAINT "DocSignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocHistory" ADD CONSTRAINT "DocHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinReply" ADD CONSTRAINT "PinReply_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegUpdate" ADD CONSTRAINT "RegUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GapAction" ADD CONSTRAINT "GapAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GapAction" ADD CONSTRAINT "GapAction_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedPackage" ADD CONSTRAINT "IssuedPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedPackage" ADD CONSTRAINT "IssuedPackage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
