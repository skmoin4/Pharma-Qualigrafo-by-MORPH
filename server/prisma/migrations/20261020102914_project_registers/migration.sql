-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discipline" TEXT,
    "area" TEXT,
    "gmpCritical" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_projectId_name_key" ON "Company"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "System_projectId_tag_key" ON "System"("projectId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_projectId_name_key" ON "Discipline"("projectId", "name");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- backfill existing projects
-- Companies: the project client (Owner) and every responsible party named on a document.
INSERT INTO "Company" ("id", "projectId", "name", "kind", "active", "createdAt")
SELECT gen_random_uuid()::text, p."id", p."client", 'Owner', true, now() FROM "Project" p
ON CONFLICT ("projectId", "name") DO NOTHING;

INSERT INTO "Company" ("id", "projectId", "name", "kind", "active", "createdAt")
SELECT gen_random_uuid()::text, d."projectId", d."owner", 'Other', true, now()
FROM (SELECT DISTINCT "projectId", "owner" FROM "Document" WHERE "owner" <> '') d
ON CONFLICT ("projectId", "name") DO NOTHING;

-- Vendor scopes must name a registered company.
INSERT INTO "Company" ("id", "projectId", "name", "kind", "active", "createdAt")
SELECT gen_random_uuid()::text, m."projectId", m."companyScope", 'Vendor / supplier', true, now()
FROM (SELECT DISTINCT "projectId", "companyScope" FROM "Membership" WHERE "companyScope" IS NOT NULL) m
ON CONFLICT ("projectId", "name") DO NOTHING;

-- Disciplines: the standard set, then any other discipline already in use.
INSERT INTO "Discipline" ("id", "projectId", "name", "position", "active")
SELECT gen_random_uuid()::text, p."id", d.name, d.pos, true
FROM "Project" p
CROSS JOIN (VALUES ('Civil & Cleanroom', 1), ('Process Equipment', 2), ('Piping & Utilities', 3), ('HVAC', 4),
                   ('Electrical', 5), ('Instrumentation', 6), ('Fire & Life Safety', 7), ('CQV', 8)) AS d(name, pos)
ON CONFLICT ("projectId", "name") DO NOTHING;

INSERT INTO "Discipline" ("id", "projectId", "name", "position", "active")
SELECT gen_random_uuid()::text, u."projectId", u."discipline", 100, true
FROM (
  SELECT "projectId", "discipline" FROM "Document"
  UNION SELECT "projectId", "discipline" FROM "Requirement"
  UNION SELECT "projectId", "discipline" FROM "Rfi"
) u WHERE u."discipline" <> ''
ON CONFLICT ("projectId", "name") DO NOTHING;

-- Systems: every tag already referenced by a record (name = tag until someone describes it).
INSERT INTO "System" ("id", "projectId", "tag", "name", "gmpCritical", "active", "createdAt")
SELECT gen_random_uuid()::text, u."projectId", u."system", u."system", false, true, now()
FROM (
  SELECT "projectId", "system" FROM "Document"
  UNION SELECT "projectId", "system" FROM "Requirement"
  UNION SELECT "projectId", "system" FROM "Rfi"
  UNION SELECT "projectId", "system" FROM "Inspection"
  UNION SELECT "projectId", "system" FROM "Change"
  UNION SELECT "projectId", "system" FROM "Risk"
  UNION SELECT "projectId", "system" FROM "Ncr"
) u WHERE u."system" <> ''
ON CONFLICT ("projectId", "tag") DO NOTHING;

-- Give each system the discipline of its documents where that is unambiguous.
UPDATE "System" s SET "discipline" = x."discipline"
FROM (SELECT "projectId", "system", MIN("discipline") AS "discipline" FROM "Document" GROUP BY "projectId", "system" HAVING COUNT(DISTINCT "discipline") = 1) x
WHERE s."projectId" = x."projectId" AND s."tag" = x."system";
