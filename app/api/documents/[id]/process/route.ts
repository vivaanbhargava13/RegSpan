import { NextResponse } from "next/server";
import { getIngestionDocument } from "@/lib/ingestion";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  let supabase;

  try {
    supabase = getServerSupabaseAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Supabase admin client is not configured on the server.",
      },
      { status: 500 },
    );
  }

  const { id } = await params;
  const { data: document, error: documentError } = await getIngestionDocument(
    supabase,
    id,
  );

  if (documentError) {
    return NextResponse.json(
      { ok: false, error: `Unable to load document: ${documentError.message}` },
      { status: 500 },
    );
  }

  if (!document) {
    return NextResponse.json(
      { ok: false, error: "Document not found." },
      { status: 404 },
    );
  }

  const now = new Date().toISOString();
  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .insert({
      workspace_id: document.workspace_id,
      document_id: document.id,
      status: "Queued",
      step: "Awaiting document processing",
      updated_at: now,
    })
    .select("id")
    .single();

  if (jobError) {
    return NextResponse.json(
      { ok: false, error: `Unable to queue processing job: ${jobError.message}` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabase
    .from("documents")
    .update({ status: "Queued", chunks_label: "Pending" })
    .eq("workspace_id", document.workspace_id)
    .eq("id", document.id);

  if (updateError) {
    await supabase
      .from("processing_jobs")
      .update({
        status: "Failed",
        step: "Queue setup failed",
        error_message: updateError.message,
        completed_at: now,
        updated_at: now,
      })
      .eq("id", job.id);

    return NextResponse.json(
      { ok: false, error: `Unable to update document status: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, jobId: job.id });
}
