export type EvalRiskLevel = "low" | "medium" | "high" | "critical";

export type IomEvalCase<Input, Expected> = {
  id: string;
  input: Input;
  expected: Expected;
  metadata: {
    datasetVersion: string;
    slice: string;
    riskLevel: EvalRiskLevel;
    smoke?: boolean;
    policyVersion: number;
    promptVersion: string;
  };
};

export type ConfidentialityEvalInput = {
  text: string;
  section?: string;
  page?: number;
  manualMarkers: Array<{ kind: "CONFIDENTIAL" | "EMPLOYEE_SAFE" | "NOTE"; note?: string }>;
};

export type ConfidentialityExpected = {
  visibility: "EMPLOYEE_SAFE" | "HR_ONLY" | "NEEDS_REVIEW";
  forbiddenVisibility?: "EMPLOYEE_SAFE";
  mustEscalate?: boolean;
  expectedBehavior: string;
  forbiddenBehavior: string;
};

export type OverlapEvalInput = {
  candidateVersionId: string;
  existingVersionId: string;
  candidateChunks: Array<{ id: string; text: string }>;
  existingChunks: Array<{ id: string; text: string }>;
  evidencePairs: Array<{ candidateChunkId: string; existingChunkId: string }>;
};

export type OverlapExpected = {
  recommendation:
    | "REPLACES"
    | "PARTIALLY_OVERRIDES"
    | "COMPLEMENTS"
    | "NO_MATERIAL_OVERLAP"
    | "MANUAL_REVIEW";
  expectedBehavior: string;
  forbiddenBehavior: string;
};

export type ChatEvalInput = {
  question: string;
  authorizedContext: string[];
  accessScope: "EMPLOYEE" | "HR";
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export type ChatExpected = {
  expectedBehavior: string;
  forbiddenBehavior: string;
  mustAbstain?: boolean;
  mustNotDiscloseHrOnly?: boolean;
};
