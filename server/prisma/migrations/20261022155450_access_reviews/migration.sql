-- CreateTable
CREATE TABLE "AccessReview" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "startedById" TEXT,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TEXT NOT NULL,
    "completedById" TEXT,
    "completedBy" TEXT,
    "completedByEmail" TEXT,
    "completedAt" TIMESTAMP(3),
    "conclusion" TEXT,
    "meaning" TEXT,
    "sigHash" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "AccessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewItem" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "isAdmin" BOOLEAN NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "accountCreatedAt" TIMESTAMP(3) NOT NULL,
    "memberships" JSONB NOT NULL,
    "flags" JSONB NOT NULL,
    "decision" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AccessReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessReview_code_key" ON "AccessReview"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_reviewId_userId_key" ON "AccessReviewItem"("reviewId", "userId");

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AccessReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
