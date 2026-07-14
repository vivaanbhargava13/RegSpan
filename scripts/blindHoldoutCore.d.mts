export class BlindHoldoutSchemaError extends Error {}
export const HOLDOUT_STATUSES: string[];
export const EVIDENCE_REVIEW_LABELS: string[];
export function validateBlindCorpusManifest(manifest: unknown): {
  id: string;
  version: number;
  cases: Array<Record<string, unknown>>;
};
export function quoteDigest(quote: unknown): string;
export function toBlindExecutionArtifact(state: Record<string, unknown>): Record<string, unknown>;
export function validateBlindExecutionArtifact(artifact: unknown): Record<string, unknown>;
export function validateBlindAnswerKey(answerKey: unknown): Record<string, unknown>;
export function validateEvidenceReviews(reviews: unknown): Record<string, unknown>;
export function statusMetrics(records: Array<Record<string, unknown>>): Record<string, unknown>;
export function repeatabilityMetrics(records: Array<Record<string, unknown>>, runIds: string[]): Record<string, unknown>;
export function bootstrapHoldoutMetrics(input: Record<string, unknown>): Record<string, unknown>;
export function scoreBlindHoldout(input: Record<string, unknown>): Record<string, unknown>;
export function evidenceReviewTemplateRows(metrics: Record<string, unknown>): Array<Record<string, unknown>>;
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string;
export function renderBlindHoldoutSummary(metrics: Record<string, unknown>): string;
