export class CorpusManifestError extends Error {}
export class CorpusEvaluationTimeoutError extends Error {}
export class CorpusEvaluationRateLimitWaitExceededError extends Error {}
export class CorpusEvaluationSafetyError extends Error {}
export function validateCorpusManifest(manifest: unknown): {
  id: string;
  version: 1;
  cases: Array<Record<string, unknown>>;
};
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
export function scoreCaseFindings(input: Record<string, unknown>): Record<string, unknown>;
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
export function snapshotSetViolations(actualDocumentIds: string[], expectedDocumentIds: string[]): string[];
