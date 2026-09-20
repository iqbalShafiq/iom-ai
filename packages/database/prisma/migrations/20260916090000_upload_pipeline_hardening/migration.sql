ALTER TABLE "UploadBatch"
ADD COLUMN "expectedFiles" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sealedAt" TIMESTAMP(3);

ALTER TABLE "IomVersion"
ADD COLUMN "metadataConfirmedAt" TIMESTAMP(3),
ADD COLUMN "metadataConfirmedById" UUID;

ALTER TABLE "IomRelation"
ADD COLUMN "overlapDecisionId" UUID;

CREATE UNIQUE INDEX "IomRelation_overlapDecisionId_key" ON "IomRelation"("overlapDecisionId");

ALTER TABLE "IomRelation"
ADD CONSTRAINT "IomRelation_overlapDecisionId_fkey"
FOREIGN KEY ("overlapDecisionId") REFERENCES "OverlapDecision"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "UploadedFile_sha256_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UploadedFile"
    GROUP BY "sha256"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce UploadedFile sha256 uniqueness: duplicate hashes exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "UploadedFile_sha256_key" ON "UploadedFile"("sha256");
