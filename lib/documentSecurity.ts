import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { IngestionDocument } from "@/lib/ingestion";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const PDF_MIME_TYPE = "application/pdf";

export class DocumentRequestError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(publicMessage);
    this.name = "DocumentRequestError";
  }
}

export type AuthorizedDocument = IngestionDocument & {
  storage_path: string | null;
  document_type: string | null;
  notes: string | null;
};

export type RequestActor = {
  user: User;
  accessToken: string;
};

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function getCorrelationId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const candidate = forwarded || realIp;

  if (!candidate || candidate.length > 64 || !/^[0-9a-f:.]+$/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new DocumentRequestError(
      "Authentication is required.",
      401,
      "authentication_required",
    );
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new DocumentRequestError(
      "Authentication is required.",
      401,
      "authentication_required",
    );
  }

  return token;
}

export async function authenticateRequest(
  supabaseAdmin: SupabaseClient,
  request: Request,
): Promise<RequestActor> {
  const accessToken = getBearerToken(request);
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new DocumentRequestError(
      "Your session is invalid or expired.",
      401,
      "invalid_session",
    );
  }

  return { user: data.user, accessToken };
}

export async function getActorWorkspaceId(
  supabaseAdmin: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[RegSpan security] Workspace membership lookup failed", {
      userId,
      error: error.message,
    });
    throw new DocumentRequestError(
      "Unable to verify workspace access.",
      500,
      "workspace_lookup_failed",
    );
  }

  if (!data?.workspace_id) {
    throw new DocumentRequestError(
      "No workspace is provisioned for this account.",
      403,
      "workspace_not_found",
    );
  }

  return data.workspace_id as string;
}

export async function authorizeDocumentRequest(
  supabaseAdmin: SupabaseClient,
  request: Request,
  documentId: string,
) {
  if (!isUuid(documentId)) {
    throw new DocumentRequestError("Document not found.", 404, "document_not_found");
  }

  const actor = await authenticateRequest(supabaseAdmin, request);
  const { data: document, error: documentError } = await supabaseAdmin
    .from("documents")
    .select(
      "id, workspace_id, filename, status, storage_path, document_type, notes",
    )
    .eq("id", documentId)
    .maybeSingle<AuthorizedDocument>();

  if (documentError) {
    console.error("[RegSpan security] Document authorization lookup failed", {
      documentId,
      userId: actor.user.id,
      error: documentError.message,
    });
    throw new DocumentRequestError(
      "Unable to verify document access.",
      500,
      "document_lookup_failed",
    );
  }

  if (!document?.workspace_id) {
    throw new DocumentRequestError("Document not found.", 404, "document_not_found");
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", document.workspace_id)
    .eq("user_id", actor.user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("[RegSpan security] Document membership check failed", {
      documentId,
      userId: actor.user.id,
      error: membershipError.message,
    });
    throw new DocumentRequestError(
      "Unable to verify document access.",
      500,
      "membership_lookup_failed",
    );
  }

  // Deliberately conceal whether another workspace owns the requested UUID.
  if (!membership) {
    throw new DocumentRequestError("Document not found.", 404, "document_not_found");
  }

  return { actor, document };
}

export function sanitizePdfFilename(filename: string) {
  const basename = filename.split(/[\\/]/).pop()?.trim() || "document.pdf";
  const stem = basename.replace(/\.pdf$/i, "").replace(/[^a-z0-9._ -]+/gi, "-");
  const safeStem = stem.replace(/\.{2,}/g, ".").replace(/^\.+/, "").slice(0, 160);
  return `${safeStem || "document"}.pdf`;
}

export async function validatePdfFile(value: FormDataEntryValue | null) {
  if (!(value instanceof File)) {
    throw new DocumentRequestError("Choose a PDF file.", 400, "file_required");
  }

  if (value.size === 0) {
    throw new DocumentRequestError("The PDF file is empty.", 400, "empty_file");
  }

  if (value.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentRequestError(
      "The PDF exceeds the 10 MB upload limit.",
      413,
      "file_too_large",
    );
  }

  if (value.type !== PDF_MIME_TYPE || !value.name.toLowerCase().endsWith(".pdf")) {
    throw new DocumentRequestError("Only PDF files are accepted.", 415, "invalid_file_type");
  }

  const signature = new Uint8Array(await value.slice(0, 5).arrayBuffer());
  const isPdfSignature =
    signature.length === 5 &&
    signature[0] === 0x25 &&
    signature[1] === 0x50 &&
    signature[2] === 0x44 &&
    signature[3] === 0x46 &&
    signature[4] === 0x2d;

  if (!isPdfSignature) {
    throw new DocumentRequestError(
      "The uploaded file is not a valid PDF.",
      415,
      "invalid_pdf_signature",
    );
  }

  return value;
}

export function documentErrorResponse(error: unknown) {
  if (error instanceof DocumentRequestError) {
    return {
      status: error.status,
      body: { ok: false, error: error.publicMessage, code: error.code },
    };
  }

  if (
    error instanceof Error &&
    error.message.startsWith("Missing required server environment variable:")
  ) {
    return {
      status: 500,
      body: { ok: false, error: error.message, code: "server_configuration_error" },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: "The server could not complete the request.",
      code: "internal_error",
    },
  };
}
