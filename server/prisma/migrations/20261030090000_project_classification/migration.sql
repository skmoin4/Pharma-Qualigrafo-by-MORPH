-- Phase 5 / step 1: project classification (multi-industry).
-- Renames only, plus new columns: no column holding customer data is dropped (PRODUCTION_PLAN §6.6).

-- 1. Renames. "plant" is meaningless outside pharma (decision §6.4.5), and the facility / phase fields become
--    reference-data driven rather than pharma unions (decisions §6.4.7 and §6.4.4).
ALTER TABLE "Project" RENAME COLUMN "facility" TO "facilityType";
ALTER TABLE "Project" RENAME COLUMN "phase" TO "projectStage";
ALTER TABLE "Project" RENAME COLUMN "plantCountry" TO "projectCountry";

-- 2. New classification columns. The defaults are what every project that exists today is: a pharma project.
ALTER TABLE "Project" ADD COLUMN "industryGroup" TEXT NOT NULL DEFAULT 'Pharma';
ALTER TABLE "Project" ADD COLUMN "secondaryFacilityType" TEXT;
ALTER TABLE "Project" ADD COLUMN "customFacilityType" TEXT;
ALTER TABLE "Project" ADD COLUMN "serviceType" TEXT NOT NULL DEFAULT 'Design only';
ALTER TABLE "Project" ADD COLUMN "bimRequirement" JSONB;

-- 3. Backfill of decision §6.4.4: a project that had the Revit connector switched on was always a Design + BIM job.
UPDATE "Project" SET "serviceType" = 'Design + BIM' WHERE "revitMode" = true;
