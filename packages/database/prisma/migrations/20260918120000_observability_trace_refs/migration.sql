ALTER TABLE "ConfidentialityDecision"
ADD COLUMN "observabilityTraceId" TEXT,
ADD COLUMN "observabilityObservationId" TEXT;

ALTER TABLE "OverlapMatch"
ADD COLUMN "observabilityTraces" JSONB;

ALTER TABLE "ConversationMessage"
ADD COLUMN "observabilityTraceId" TEXT,
ADD COLUMN "observabilityObservationId" TEXT;
