type AiProcessingEnvironment = Record<string, string | undefined>;

if (typeof window !== "undefined") {
  throw new Error("AI processing policy helpers are server-only.");
}

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isExternalAiProcessingEnabled(
  environment: AiProcessingEnvironment = process.env,
) {
  return isEnabled(environment.ENABLE_EXTERNAL_AI_PROCESSING);
}

export function isExternalAiClassifierEnabled(
  environment: AiProcessingEnvironment = process.env,
) {
  return isExternalAiProcessingEnabled(environment)
    && isEnabled(environment.ENABLE_EXTERNAL_AI_CLASSIFIER);
}
