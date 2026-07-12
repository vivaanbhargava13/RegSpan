export class CorpusManifestError extends Error {}
export class CorpusEvaluationTimeoutError extends Error {}
export class CorpusEvaluationSafetyError extends Error {}
export function validateCorpusManifest(manifest: unknown): {
  id: string;
  version: 1;
  cases: Array<Record<string, unknown>>;
};
export function pollForTerminal<T>(input: Record<string, unknown>): Promise<T>;
export function scoreCaseFindings(input: Record<string, unknown>): Record<string, unknown>;
export function evidenceIntegrityViolations(input: Record<string, unknown>): string[];
export function assertCorpusEvaluationSafety(input: Record<string, unknown>): {
  actorUserId: string;
  workspacePrefix: string;
};
export function evaluationWorkspaceName(input: Record<string, string>): string;
export function assertFreshEvaluationWorkspace(existingCount: number): void;
export function createOneShotEvaluationState(input: Record<string, unknown>): Record<string, unknown>;
export function recordEvaluationFailure<T>(state: T, caseId: string | null, message: string): T;
export function snapshotSetViolations(actualDocumentIds: string[], expectedDocumentIds: string[]): string[];
