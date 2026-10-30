-- Phase 5 / step 2: library items can state which industry groups they apply to.
-- Nullable and empty-means-all, so every item that exists keeps applying exactly as before.
ALTER TABLE "LibraryItem" ADD COLUMN "industries" JSONB;
