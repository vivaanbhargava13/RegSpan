import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getIngestionDocument, type IngestionDocument } from "@/lib/ingestion";

export class IngestionAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "IngestionAuthorizationError";
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new IngestionAuthorizationError("Authentication is required.", 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new IngestionAuthorizationError("Authentication is required.", 401);
  }

  return token;
}

export async function authorizeIngestionRequest(
  supabaseAdmin: SupabaseClient,
  request: Request,
  documentId: string,
): Promise<IngestionDocument> {
  const token = getBearerToken(request);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !userData.user) {
    throw new IngestionAuthorizationError("Your session is invalid or expired.", 401);
  }

  const { data: document, error: documentError } = await getIngestionDocument(
    supabaseAdmin,
    documentId,
  );

  if (documentError) {
    throw new IngestionAuthorizationError(
      `Unable to load document: ${documentError.message}`,
      500,
    );
  }

  if (!document?.workspace_id) {
    throw new IngestionAuthorizationError("Document not found.", 404);
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", document.workspace_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError) {
    throw new IngestionAuthorizationError(
      `Unable to verify workspace access: ${membershipError.message}`,
      500,
    );
  }

  if (!membership) {
    throw new IngestionAuthorizationError("Document not found.", 404);
  }

  return document;
}
