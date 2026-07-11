import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIp, getCorrelationId } from "@/lib/documentSecurity";

type AuditEvent = {
  request: Request;
  action: string;
  outcome: "success" | "failure" | "partial";
  workspaceId?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordSecurityAuditEvent(
  supabaseAdmin: SupabaseClient,
  event: AuditEvent,
) {
  const { error } = await supabaseAdmin.from("security_audit_events").insert({
    workspace_id: event.workspaceId ?? null,
    actor_user_id: event.actorUserId ?? null,
    action: event.action,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    result: event.outcome,
    ip_address: getClientIp(event.request),
    user_agent: event.request.headers.get("user-agent")?.slice(0, 512) ?? null,
    correlation_id: event.correlationId ?? getCorrelationId(event.request),
    metadata: event.metadata ?? {},
  });

  if (error) {
    // Audit writes are best effort so a logging outage does not corrupt lifecycle work.
    console.error("[RegSpan security] Audit event insert failed", {
      event: "security_audit.insert_failed",
      action: event.action,
      workspaceId: event.workspaceId ?? null,
      targetId: event.targetId,
      correlationId: event.correlationId,
      stage: event.metadata?.failing_stage ?? "write_audit_event",
      error: error.message,
    });
  }
}
