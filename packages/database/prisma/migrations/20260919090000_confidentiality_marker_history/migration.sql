ALTER TABLE "IomAnnotation"
ADD COLUMN "revokedById" UUID,
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "revokeReason" TEXT;

ALTER TABLE "IomAnnotation"
ADD CONSTRAINT "IomAnnotation_revokedById_fkey"
FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConfidentialityDecision"
ADD CONSTRAINT "ConfidentialityDecision_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "IomAnnotation_versionId_revokedAt_idx"
ON "IomAnnotation"("versionId", "revokedAt");
