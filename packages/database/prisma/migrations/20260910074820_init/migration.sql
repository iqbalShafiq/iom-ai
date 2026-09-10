-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'HR_ADMIN');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('EMPLOYEE', 'HR');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('EMPLOYEE_SAFE', 'HR_ONLY', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "IomStatus" AS ENUM ('DRAFT', 'PROCESSING', 'IN_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "IomRelationType" AS ENUM ('REPLACES', 'COMPLEMENTS', 'PARTIALLY_OVERRIDES', 'RELATED');

-- CreateEnum
CREATE TYPE "UploadStage" AS ENUM ('QUEUED', 'EXTRACTING', 'OCR', 'CLASSIFYING', 'REVIEWING', 'INDEXING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'EVALUATING', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AnnotationKind" AS ENUM ('CONFIDENTIAL', 'EMPLOYEE_SAFE', 'NOTE');

-- CreateEnum
CREATE TYPE "OverlapRecommendation" AS ENUM ('ARCHIVE_EXISTING', 'PUBLISH_AS_COMPLEMENT', 'NO_MATERIAL_OVERLAP', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Percakapan baru',
    "accessScope" "AccessScope" NOT NULL,
    "modelId" TEXT NOT NULL,
    "reasoningEffort" TEXT NOT NULL,
    "corpusPolicyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "modelId" TEXT,
    "reasoningEffort" TEXT,
    "usage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "note" TEXT,
    "defaultConfidential" BOOLEAN NOT NULL DEFAULT false,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "stage" "UploadStage" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "safeError" TEXT,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IomDocument" (
    "id" UUID NOT NULL,
    "stableKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IomDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IomVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "uploadedFileId" UUID,
    "iomNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IomStatus" NOT NULL DEFAULT 'DRAFT',
    "publicationDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "sourceHash" TEXT NOT NULL,
    "confidentialityPolicyId" UUID,
    "reviewedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IomVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IomRelation" (
    "id" UUID NOT NULL,
    "sourceVersionId" UUID NOT NULL,
    "targetVersionId" UUID NOT NULL,
    "type" "IomRelationType" NOT NULL,
    "topicScope" JSONB,
    "note" TEXT,
    "confirmedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IomRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IomChunk" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "section" TEXT,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "text" TEXT NOT NULL,
    "publicText" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "classificationConfidence" DOUBLE PRECISION,
    "vectorGeneration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IomChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IomAnnotation" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "kind" "AnnotationKind" NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "section" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IomAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidentialityPolicy" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "examples" JSONB NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfidentialityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidentialityDecision" (
    "id" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "visibility" "Visibility" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "categories" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "sensitiveSpans" JSONB NOT NULL,
    "conflictsWithMarker" BOOLEAN NOT NULL,
    "modelId" TEXT NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidentialityDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlapRun" (
    "id" UUID NOT NULL,
    "candidateVersionId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OverlapRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlapMatch" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "existingVersionId" UUID NOT NULL,
    "recommendation" "OverlapRecommendation" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sharedTopics" JSONB NOT NULL,
    "changedRules" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverlapMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlapDecision" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "decidedById" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverlapDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "correlationId" TEXT NOT NULL,
    "resultStatus" TEXT NOT NULL,
    "modelId" TEXT,
    "reasoningEffort" TEXT,
    "policyVersion" INTEGER,
    "sourceIds" JSONB,
    "safeMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_updatedAt_idx" ON "Conversation"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadBatch_createdAt_idx" ON "UploadBatch"("createdAt");

-- CreateIndex
CREATE INDEX "UploadedFile_sha256_idx" ON "UploadedFile"("sha256");

-- CreateIndex
CREATE INDEX "UploadedFile_batchId_stage_idx" ON "UploadedFile"("batchId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_batchId_sha256_key" ON "UploadedFile"("batchId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_availableAt_idx" ON "BackgroundJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_leaseExpiresAt_idx" ON "BackgroundJob"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IomDocument_stableKey_key" ON "IomDocument"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "IomVersion_uploadedFileId_key" ON "IomVersion"("uploadedFileId");

-- CreateIndex
CREATE INDEX "IomVersion_status_effectiveFrom_effectiveUntil_idx" ON "IomVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "IomVersion_iomNumber_idx" ON "IomVersion"("iomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IomVersion_documentId_revision_key" ON "IomVersion"("documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "IomRelation_sourceVersionId_targetVersionId_type_key" ON "IomRelation"("sourceVersionId", "targetVersionId", "type");

-- CreateIndex
CREATE INDEX "IomChunk_versionId_visibility_idx" ON "IomChunk"("versionId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "IomChunk_versionId_stableKey_key" ON "IomChunk"("versionId", "stableKey");

-- CreateIndex
CREATE INDEX "IomAnnotation_versionId_pageStart_idx" ON "IomAnnotation"("versionId", "pageStart");

-- CreateIndex
CREATE UNIQUE INDEX "ConfidentialityPolicy_version_key" ON "ConfidentialityPolicy"("version");

-- CreateIndex
CREATE INDEX "ConfidentialityDecision_chunkId_createdAt_idx" ON "ConfidentialityDecision"("chunkId", "createdAt");

-- CreateIndex
CREATE INDEX "OverlapRun_candidateVersionId_createdAt_idx" ON "OverlapRun"("candidateVersionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OverlapMatch_runId_existingVersionId_key" ON "OverlapMatch"("runId", "existingVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "OverlapDecision_matchId_key" ON "OverlapDecision"("matchId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomVersion" ADD CONSTRAINT "IomVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IomDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomVersion" ADD CONSTRAINT "IomVersion_uploadedFileId_fkey" FOREIGN KEY ("uploadedFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomVersion" ADD CONSTRAINT "IomVersion_confidentialityPolicyId_fkey" FOREIGN KEY ("confidentialityPolicyId") REFERENCES "ConfidentialityPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomRelation" ADD CONSTRAINT "IomRelation_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "IomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomRelation" ADD CONSTRAINT "IomRelation_targetVersionId_fkey" FOREIGN KEY ("targetVersionId") REFERENCES "IomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomChunk" ADD CONSTRAINT "IomChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IomVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomAnnotation" ADD CONSTRAINT "IomAnnotation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "IomVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IomAnnotation" ADD CONSTRAINT "IomAnnotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityDecision" ADD CONSTRAINT "ConfidentialityDecision_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "IomChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfidentialityDecision" ADD CONSTRAINT "ConfidentialityDecision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ConfidentialityPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlapRun" ADD CONSTRAINT "OverlapRun_candidateVersionId_fkey" FOREIGN KEY ("candidateVersionId") REFERENCES "IomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlapMatch" ADD CONSTRAINT "OverlapMatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OverlapRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlapMatch" ADD CONSTRAINT "OverlapMatch_existingVersionId_fkey" FOREIGN KEY ("existingVersionId") REFERENCES "IomVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlapDecision" ADD CONSTRAINT "OverlapDecision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "OverlapMatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
