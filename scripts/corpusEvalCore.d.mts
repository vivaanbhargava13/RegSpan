export class CorpusManifestError extends Error {}
export class CorpusEvaluationTimeoutError extends Error {}
export class CorpusEvaluationRateLimitWaitExceededError extends Error {}
export class CorpusEvaluationSafetyError extends Error {}
export function normalizeCorpusManifest(manifest: unknown): Record<string, unknown>;
export function validateCorpusManifest(manifest: unknown, options?: {
  canonicalRequirementElements?: Record<string, string[]>;
}): {
  id: string;
  version: 1 | 2;
  cases: Array<Record<string, unknown>>;
};
export function selectCorpusCases(input: {
  cases: Array<{ id: string; include?: { isolated?: boolean; combined?: boolean } }>;
  requestedCaseIds?: string[];
  mode: "isolated" | "combined";
}): {
  selectedCases: Array<{ id: string; include?: { isolated?: boolean; combined?: boolean } }>;
  selectedCaseIds: string[];
  filtered: boolean;
};
export function corpusChunkClassificationViolations(input: {
  chunks: Array<{ metadata?: Record<string, unknown> | null }>;
  sourceType: "client_policy" | "client_procedure" | "client_standard";
  requireOrganizationEvidence: boolean;
}): string[];
export function pollForTerminal<T>(input: Record<string, unknown>): Promise<T>;
export function retryRateLimitedOperation<T>(input: {
  operation: () => Promise<T>;
  beforeRetry?: () => Promise<T | null>;
  isRateLimitError: (error: unknown) => boolean;
  waitOnRateLimit?: boolean;
  maxRateLimitWaitMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onWait?: (details: { rateLimitWaitCount: number; rateLimitWaitMs: number; waitMs: number }) => Promise<void>;
}): Promise<{ value: T; rateLimitWaitCount: number; rateLimitWaitMs: number }>;
export function scoreCaseFindings(input: Record<string, unknown> & {
  resolveFinalQuoteElementIds?: (input: {
    requirementId: string;
    finding: Record<string, unknown>;
    evidence: Record<string, unknown>;
    quote: string;
  }) => string[];
}): Record<string, unknown>;
export function evidenceIntegrityViolations(input: Record<string, unknown>): string[];
export function assertCorpusEvaluationSafety(input: Record<string, unknown>): {
  actorUserId: string;
  workspacePrefix: string;
};
export function assertCorpusEvaluationExternalAiOptIn(allowExternalAi: boolean): void;
export function evaluationAnalysisRateLimitCategory(input: {
  evaluationAuthorized: boolean;
  workspaceName: string;
  workspacePrefix: string;
  actorOwnsWorkspace: boolean;
  environment?: Record<string, string | undefined>;
}): "findings_generate_eval";
export function evaluationDocumentUploadRateLimitCategory(input: {
  evaluationAuthorized: boolean;
  workspaceName: string;
  workspacePrefix: string;
  actorOwnsWorkspace: boolean;
  environment?: Record<string, string | undefined>;
}): "document_upload_eval";
export function processingResultForReport(input: {
  status: string;
  step?: string | null;
  errorMessage?: string | null;
}): {
  processingStatus: "failed" | "processed";
  processingStep?: string;
  processingError?: string;
};
export function evaluationWorkspaceName(input: Record<string, string>): string;
export function assertFreshEvaluationWorkspace(existingCount: number): void;
export function newEvaluationWorkspaceValues(input: {
  workspaceName: string;
  actorUserId: string;
  externalAiProcessingEnabled: boolean;
}): {
  name: string;
  owner_user_id: string;
  external_ai_processing_enabled: true;
};
export function createOneShotEvaluationState(input: Record<string, unknown>): Record<string, unknown>;
export function recordEvaluationFailure<T>(state: T, caseId: string | null, message: string, diagnosticCode?: string): T;
export function runIsolatedCaseSequence<T>(input: {
  cases: T[];
  runCase: (definition: T) => Promise<void>;
  onCaseFailure: (definition: T, error: unknown) => Promise<void>;
}): Promise<void>;
export function summarizeEvaluationState(state: Record<string, unknown>): Record<string, unknown>;
export function formatEvaluationStatusAccuracy(summary: {
  allSelectedCasesCompleted: boolean;
  score: number;
  matched: number;
  expected: number;
  evaluatedStatusMatched: number;
  evaluatedStatusExpected: number;
}): string;
export function snapshotSetViolations(actualDocumentIds: string[], expectedDocumentIds: string[]): string[];
