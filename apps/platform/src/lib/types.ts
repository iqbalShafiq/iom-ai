export interface User {
  id: string;
  email: string;
  name: string;
  role: "EMPLOYEE" | "HR_ADMIN";
}

export interface Conversation {
  id: string;
  title: string;
  accessScope: "EMPLOYEE" | "HR";
  modelId: string;
  reasoningEffort: string;
  updatedAt: string;
}

export interface UploadFileRow {
  id: string;
  originalName: string;
  mimeType: string;
  stage: string;
  progress: number;
  safeError?: string | null;
}

export interface UploadBatchRow {
  id: string;
  note?: string | null;
  createdAt: string;
  files: UploadFileRow[];
}

export interface IomVersionRow {
  id: string;
  iomNumber: string;
  title: string;
  revision: number;
  chunkingStrategy?: "LEGACY_SECTION" | "PAGE";
  status: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
  metadataConfirmedAt?: string | null;
  document?: { id: string; stableKey: string };
  _count?: { chunks: number };
  chunks?: Array<{
    id: string;
    ordinal: number;
    pageStart?: number | null;
    text: string;
    publicText?: string | null;
    visibility: string;
    classificationConfidence?: number | null;
    decisions: Array<{
      id: string;
      rationale: string;
      reviewedAt?: string | null;
      categories: string[];
      sensitiveSpans: Array<{ start: number; end: number; reason: string }>;
    }>;
  }>;
  annotations?: unknown[];
  outgoingRelations?: Array<{ id: string; type: string; targetVersion: IomVersionRow }>;
  incomingRelations?: Array<{ id: string; type: string; sourceVersion: IomVersionRow }>;
  uploadedFile?: UploadFileRow | null;
}
