-- Overlap resolution introduces explicit, auditable HR decisions and run coverage.

ALTER TYPE "OverlapRecommendation" RENAME TO "OverlapRecommendation_old";
CREATE TYPE "OverlapRecommendation" AS ENUM ('REPLACES', 'PARTIALLY_OVERRIDES', 'COMPLEMENTS', 'NO_MATERIAL_OVERLAP', 'MANUAL_REVIEW');

ALTER TABLE "OverlapMatch"
  ALTER COLUMN "recommendation" TYPE "OverlapRecommendation"
  USING CASE "recommendation"::text
    WHEN 'ARCHIVE_EXISTING' THEN 'REPLACES'::"OverlapRecommendation"
    WHEN 'PUBLISH_AS_COMPLEMENT' THEN 'COMPLEMENTS'::"OverlapRecommendation"
    ELSE "recommendation"::text::"OverlapRecommendation"
  END;
DROP TYPE "OverlapRecommendation_old";

CREATE TYPE "OverlapDecisionStatus" AS ENUM ('PENDING_REVIEW', 'FINAL');
CREATE TYPE "OverlapDecisionOutcome" AS ENUM ('REPLACES', 'PARTIALLY_OVERRIDES', 'COMPLEMENTS', 'NO_MATERIAL_OVERLAP');
CREATE TYPE "OverlapRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

ALTER TABLE "OverlapRun"
  ALTER COLUMN "status" TYPE "OverlapRunStatus"
  USING CASE upper("status")
    WHEN 'QUEUED' THEN 'QUEUED'::"OverlapRunStatus"
    WHEN 'RUNNING' THEN 'RUNNING'::"OverlapRunStatus"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"OverlapRunStatus"
    ELSE 'FAILED'::"OverlapRunStatus"
  END;

ALTER TABLE "OverlapRun"
  ADD COLUMN "coverageComplete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "analysisMetrics" JSONB,
  ADD COLUMN "noMatchConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "noMatchConfirmedById" UUID,
  ADD COLUMN "noMatchNote" TEXT;

ALTER TABLE "OverlapDecision"
  ADD COLUMN "status" "OverlapDecisionStatus",
  ADD COLUMN "outcome" "OverlapDecisionOutcome",
  ADD COLUMN "rationale" TEXT,
  ADD COLUMN "topicScope" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "OverlapDecision"
SET
  "status" = CASE WHEN "decision" = 'MANUAL_REVIEW' THEN 'PENDING_REVIEW'::"OverlapDecisionStatus" ELSE 'FINAL'::"OverlapDecisionStatus" END,
  "outcome" = CASE "decision"
    WHEN 'ARCHIVE_EXISTING' THEN 'REPLACES'::"OverlapDecisionOutcome"
    WHEN 'PUBLISH_AS_COMPLEMENT' THEN 'COMPLEMENTS'::"OverlapDecisionOutcome"
    WHEN 'NO_MATERIAL_OVERLAP' THEN 'NO_MATERIAL_OVERLAP'::"OverlapDecisionOutcome"
    ELSE NULL
  END,
  "rationale" = CASE
    WHEN "decision" = 'MANUAL_REVIEW' THEN COALESCE(NULLIF("note", ''), 'Keputusan manual lama perlu ditinjau dan diselesaikan ulang oleh HR.')
    ELSE "note"
  END;

ALTER TABLE "OverlapDecision"
  ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "OverlapDecision"
  DROP COLUMN "decision",
  DROP COLUMN "note";

ALTER TABLE "OverlapRun"
  ADD CONSTRAINT "OverlapRun_noMatchConfirmedById_fkey"
  FOREIGN KEY ("noMatchConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OverlapDecision"
  ADD CONSTRAINT "OverlapDecision_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OverlapRun_noMatchConfirmedById_idx" ON "OverlapRun"("noMatchConfirmedById");

-- Keep the newest active run when old application versions created duplicates. The older rows
-- remain visible as failed history so the partial unique index can be installed safely.
WITH active_duplicates AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "candidateVersionId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "OverlapRun"
  WHERE "status" IN ('QUEUED', 'RUNNING')
)
UPDATE "OverlapRun"
SET
  "status" = 'FAILED',
  "errorCode" = 'OVERLAP_DUPLICATE_ACTIVE_RUN',
  "coverageComplete" = false,
  "completedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
WHERE "id" IN (
  SELECT "id" FROM active_duplicates WHERE row_number > 1
);

CREATE UNIQUE INDEX "OverlapRun_one_active_per_candidate"
  ON "OverlapRun"("candidateVersionId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
