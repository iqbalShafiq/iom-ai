import { z } from "zod";

export const roleSchema = z.enum(["EMPLOYEE", "HR_ADMIN"]);
export type Role = z.infer<typeof roleSchema>;

export const accessScopeSchema = z.enum(["EMPLOYEE", "HR"]);
export type AccessScope = z.infer<typeof accessScopeSchema>;

export const visibilitySchema = z.enum(["EMPLOYEE_SAFE", "HR_ONLY", "NEEDS_REVIEW"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const iomStatusSchema = z.enum([
  "DRAFT",
  "PROCESSING",
  "IN_REVIEW",
  "READY_TO_PUBLISH",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
  "FAILED",
]);
export type IomStatus = z.infer<typeof iomStatusSchema>;

export const relationTypeSchema = z.enum([
  "REPLACES",
  "COMPLEMENTS",
  "PARTIALLY_OVERRIDES",
  "RELATED",
]);
export type IomRelationType = z.infer<typeof relationTypeSchema>;

export const jobStatusSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "DEAD_LETTER"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const uploadStageSchema = z.enum([
  "QUEUED",
  "EXTRACTING",
  "OCR",
  "CLASSIFYING",
  "REVIEWING",
  "INDEXING",
  "COMPLETED",
  "FAILED",
]);
export type UploadStage = z.infer<typeof uploadStageSchema>;

export const reasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const modelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  supportedReasoningEfforts: z.array(reasoningEffortSchema).min(1),
  defaultReasoningEffort: reasoningEffortSchema,
  supportsStreaming: z.boolean(),
  supportsTools: z.boolean(),
  supportsReasoningSummary: z.boolean(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const chatRunMetadataSchema = z.object({
  conversationId: z.string().uuid(),
  accessScope: accessScopeSchema,
  modelId: z.string().min(1),
  reasoningEffort: reasoningEffortSchema,
});
export type ChatRunMetadata = z.infer<typeof chatRunMetadataSchema>;

export const searchIomInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(1_000)
    .describe("Pertanyaan atau konsep regulasi yang dicari."),
  asOf: z.iso.date().optional().describe("Tanggal konteks aturan dalam format YYYY-MM-DD."),
  includeHistory: z.boolean().default(false).describe("Ambil versi historis yang terotorisasi."),
  topics: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
});
export type SearchIomInput = z.infer<typeof searchIomInputSchema>;

export const relationSummarySchema = z.object({
  type: relationTypeSchema,
  relatedVersionId: z.string().uuid(),
  relatedIomNumber: z.string(),
  effectiveFrom: z.iso.datetime().optional(),
  note: z.string().optional(),
});

export const iomEvidenceSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  chunkId: z.string().uuid(),
  sourceId: z.string().min(1),
  iomNumber: z.string(),
  title: z.string(),
  section: z.string().optional(),
  page: z.number().int().positive().optional(),
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime().optional(),
  text: z.string(),
  score: z.number().min(0).max(1),
  visibility: z.enum(["EMPLOYEE_SAFE", "HR_ONLY"]),
  relationContext: z.array(relationSummarySchema).default([]),
});
export type IomEvidence = z.infer<typeof iomEvidenceSchema>;

export const searchIomOutputSchema = z.object({
  evidence: z.array(iomEvidenceSchema).max(5),
  temporalScope: z.object({ asOf: z.iso.datetime(), includesHistory: z.boolean() }),
  insufficientEvidence: z.boolean(),
});
export type SearchIomOutput = z.infer<typeof searchIomOutputSchema>;

export const sensitiveSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export const confidentialityDecisionSchema = z
  .object({
    visibility: visibilitySchema,
    confidence: z.number().min(0).max(1),
    categories: z.array(z.string().min(1).max(80)).max(12),
    rationale: z.string().min(1).max(2_000),
    sensitiveSpans: z.array(sensitiveSpanSchema).max(50),
    conflictsWithMarker: z.boolean(),
  })
  .superRefine((value, context) => {
    for (const span of value.sensitiveSpans) {
      if (span.end <= span.start) {
        context.addIssue({ code: "custom", message: "A sensitive span must end after it starts." });
      }
    }
  });
export type ConfidentialityDecision = z.infer<typeof confidentialityDecisionSchema>;

export const policyExampleSchema = z.object({
  text: z.string().min(1).max(4_000),
  expectedVisibility: z.enum(["EMPLOYEE_SAFE", "HR_ONLY"]),
  explanation: z.string().max(1_000).optional(),
});

export const confidentialityPolicySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  name: z.string().min(2).max(120),
  instructions: z.string().min(20).max(20_000),
  examples: z.array(policyExampleSchema).max(50),
  status: z.enum(["DRAFT", "EVALUATING", "ACTIVE", "RETIRED"]),
});
export type ConfidentialityPolicy = z.infer<typeof confidentialityPolicySchema>;

export const overlapRecommendationSchema = z.enum([
  "ARCHIVE_EXISTING",
  "PUBLISH_AS_COMPLEMENT",
  "NO_MATERIAL_OVERLAP",
  "MANUAL_REVIEW",
]);

export const overlapMatchSchema = z.object({
  existingVersionId: z.string().uuid(),
  recommendation: overlapRecommendationSchema,
  confidence: z.number().min(0).max(1),
  sharedTopics: z.array(z.string()).max(20),
  changedRules: z.array(
    z.object({
      subject: z.string(),
      previousValue: z.string().nullable(),
      proposedValue: z.string().nullable(),
      effectiveFrom: z.iso.date().nullable(),
    }),
  ),
  conflicts: z.array(z.string()).max(20),
  evidence: z.array(
    z.object({
      candidateChunkId: z.string().uuid(),
      existingChunkId: z.string().uuid(),
      explanation: z.string(),
    }),
  ),
});
export type OverlapMatch = z.infer<typeof overlapMatchSchema>;

export const createUploadBatchSchema = z.object({
  note: z.string().trim().max(4_000).optional(),
  defaultConfidential: z.boolean().default(false),
});

export const createPolicySchema = z.object({
  name: z.string().trim().min(2).max(120),
  instructions: z.string().trim().min(20).max(20_000),
  examples: z.array(policyExampleSchema).max(50).default([]),
});

export const passwordSchema = z.string().min(8).max(256);

export const loginSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: passwordSchema,
});

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
