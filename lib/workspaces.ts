import type { SupabaseClient } from "@supabase/supabase-js";

export type CurrentWorkspace = {
  id: string;
  name: string;
  ownerUserId: string;
  role: string;
  externalAiProcessingEnabled: boolean;
};

export async function getCurrentWorkspace(
  supabase: SupabaseClient,
  knownUserId?: string,
): Promise<CurrentWorkspace> {
  let userId = knownUserId;

  if (!userId) {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw new Error(error?.message || "You must be logged in to access a workspace.");
    }

    userId = data.user.id;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Unable to load workspace membership: ${membershipError.message}`);
  }

  if (!membership) {
    throw new Error("No workspace is provisioned for this account.");
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, owner_user_id, external_ai_processing_enabled")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Unable to load workspace: ${workspaceError.message}`);
  }

  if (!workspace) {
    throw new Error("Your workspace could not be found.");
  }

  return {
    id: workspace.id,
    name: workspace.name,
    ownerUserId: workspace.owner_user_id,
    role: membership.role,
    externalAiProcessingEnabled: workspace.external_ai_processing_enabled === true,
  };
}
