import type { SupabaseClient } from "@supabase/supabase-js";

type AiProcessingEnvironment = Record<string, string | undefined>;

export type WorkspaceExternalAiProcessingPolicy = {
  workspaceId: string | null;
  workspaceConsentEnabled: boolean;
  externalAiProcessingEnabled: boolean;
  externalAiClassifierEnabled: boolean;
  denialReason: "workspace_context_missing" | "workspace_consent_disabled" | "server_policy_disabled" | null;
};

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

export function createWorkspaceExternalAiProcessingPolicy({
  workspaceId,
  workspaceConsentEnabled,
  environment = process.env,
}: {
  workspaceId?: string | null;
  workspaceConsentEnabled?: boolean | null;
  environment?: AiProcessingEnvironment;
}): WorkspaceExternalAiProcessingPolicy {
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  const consentEnabled = workspaceConsentEnabled === true;
  const serverProcessingEnabled = isExternalAiProcessingEnabled(environment);
  const externalAiProcessingEnabled = Boolean(
    normalizedWorkspaceId
      && consentEnabled
      && serverProcessingEnabled,
  );

  const denialReason = !normalizedWorkspaceId
    ? "workspace_context_missing"
    : !consentEnabled
      ? "workspace_consent_disabled"
      : !serverProcessingEnabled
        ? "server_policy_disabled"
        : null;

  return {
    workspaceId: normalizedWorkspaceId,
    workspaceConsentEnabled: consentEnabled,
    externalAiProcessingEnabled,
    externalAiClassifierEnabled: externalAiProcessingEnabled
      && isExternalAiClassifierEnabled(environment),
    denialReason,
  };
}

export async function loadWorkspaceExternalAiProcessingPolicy({
  supabase,
  workspaceId,
  environment = process.env,
}: {
  supabase: SupabaseClient;
  workspaceId?: string | null;
  environment?: AiProcessingEnvironment;
}) {
  const normalizedWorkspaceId = workspaceId?.trim() || null;
  if (!normalizedWorkspaceId) {
    return createWorkspaceExternalAiProcessingPolicy({ environment });
  }

  const { data, error } = await supabase
    .from("workspaces")
    .select("external_ai_processing_enabled")
    .eq("id", normalizedWorkspaceId)
    .maybeSingle<{ external_ai_processing_enabled: boolean | null }>();

  if (error || !data) {
    console.warn("[RegSpan security] Workspace external AI consent lookup failed", {
      workspaceId: normalizedWorkspaceId,
      code: error?.code ?? "workspace_not_found",
    });
    return createWorkspaceExternalAiProcessingPolicy({ workspaceId: normalizedWorkspaceId, environment });
  }

  return createWorkspaceExternalAiProcessingPolicy({
    workspaceId: normalizedWorkspaceId,
    workspaceConsentEnabled: data.external_ai_processing_enabled,
    environment,
  });
}
