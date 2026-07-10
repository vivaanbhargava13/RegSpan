import { NextResponse } from "next/server";
import {
  authenticateRequestOrSession,
  DocumentRequestError,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function parseExternalAiProcessingRequest(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DocumentRequestError(
      "Send an external AI processing setting.",
      400,
      "invalid_external_ai_processing_setting",
    );
  }

  const enabled = (body as Record<string, unknown>).enabled;
  if (typeof enabled !== "boolean") {
    throw new DocumentRequestError(
      "Choose whether to enable external AI processing.",
      400,
      "invalid_external_ai_processing_setting",
    );
  }

  return enabled;
}

export async function PATCH(request: Request) {
  const correlationId = getCorrelationId(request);
  let workspaceId: string | null = null;
  let actorUserId: string | null = null;

  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequestOrSession(supabase, request);
    actorUserId = actor.user.id;
    workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const enabled = parseExternalAiProcessingRequest(await request.json());

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, owner_user_id, external_ai_processing_enabled")
      .eq("id", workspaceId)
      .maybeSingle<{
        id: string;
        owner_user_id: string;
        external_ai_processing_enabled: boolean | null;
      }>();

    if (workspaceError || !workspace) {
      throw new DocumentRequestError(
        "Unable to load workspace settings.",
        500,
        "workspace_settings_lookup_failed",
      );
    }

    if (workspace.owner_user_id !== actor.user.id) {
      throw new DocumentRequestError(
        "Only the workspace owner can change external AI processing.",
        403,
        "workspace_owner_required",
      );
    }

    const previousEnabled = workspace.external_ai_processing_enabled === true;
    const { data: updatedWorkspace, error: updateError } = await supabase
      .from("workspaces")
      .update({ external_ai_processing_enabled: enabled })
      .eq("id", workspaceId)
      .eq("owner_user_id", actor.user.id)
      .select("external_ai_processing_enabled")
      .single<{ external_ai_processing_enabled: boolean }>();

    if (updateError || !updatedWorkspace) {
      throw new DocumentRequestError(
        "Unable to update external AI processing.",
        500,
        "workspace_external_ai_processing_update_failed",
      );
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "workspace.external_ai_processing.update",
      outcome: "success",
      workspaceId,
      actorUserId,
      targetType: "workspace",
      targetId: workspaceId,
      metadata: {
        previous_enabled: previousEnabled,
        enabled: updatedWorkspace.external_ai_processing_enabled === true,
      },
    });

    return NextResponse.json({
      ok: true,
      externalAiProcessingEnabled: updatedWorkspace.external_ai_processing_enabled === true,
    });
  } catch (error) {
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
