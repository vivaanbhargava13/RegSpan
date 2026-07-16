export function requirementSpecificElementMatch(
  requirementId: string,
  elementId: string,
  value: string,
): boolean | null;

export function admitsPositiveRecoveryElement(
  requirementId: string,
  elementId: string,
  quote: string,
): boolean;

export function requiresOperativeElementSupport(
  requirementId: string,
  elementIds: string[],
): boolean;

export function usesCanonicalOperativeElementModel(
  requirementId: string,
  elementIds: string[],
): boolean;
