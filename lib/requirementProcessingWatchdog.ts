export class RequirementProcessingWatchdogTimeoutError extends Error {
  constructor(public readonly requirementId: string) {
    super(`Requirement processing watchdog timed out: ${requirementId}.`);
    this.name = "RequirementProcessingWatchdogTimeoutError";
  }
}

/**
 * Bounds one sequential requirement operation. The caller owns cancellation of
 * its in-flight dependencies, which keeps this helper independent of storage,
 * provider, and evidence semantics.
 */
export async function runWithRequirementProcessingWatchdog<T>({
  requirementId,
  timeoutMs,
  operation,
  onTimeout,
}: {
  requirementId: string;
  timeoutMs: number;
  operation: () => Promise<T>;
  onTimeout?: () => void;
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Requirement processing watchdog timeout must be a positive integer.");
  }
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const watchdog = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new RequirementProcessingWatchdogTimeoutError(requirementId));
      onTimeout?.();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), watchdog]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
