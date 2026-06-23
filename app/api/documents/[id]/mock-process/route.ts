import { NextResponse } from "next/server";
import {
  createMockChunks,
  createMockHierarchy,
  getIngestionDocument,
} from "@/lib/ingestion";
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

  let jobId: string | null = null;

  try {
    const startedAt = new Date().toISOString();
    const { data: existingJob, error: existingJobError } = await supabase
      .from("processing_jobs")
      .select("id")
      .eq("workspace_id", document.workspace_id)
      .eq("document_id", document.id)
      .in("status", ["Queued", "Processing", "Reprocessing", "Failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJobError) {
      throw new Error(`Unable to look up processing job: ${existingJobError.message}`);
    }

    if (existingJob) {
      jobId = existingJob.id;
      const { error } = await supabase
        .from("processing_jobs")
        .update({
          status: "Processing",
          step: "Creating mock chunks",
          error_message: null,
          started_at: startedAt,
          completed_at: null,
          updated_at: startedAt,
        })
        .eq("id", jobId);

      if (error) {
        throw new Error(`Unable to update processing job: ${error.message}`);
      }
    } else {
      const { data: job, error } = await supabase
        .from("processing_jobs")
        .insert({
          workspace_id: document.workspace_id,
          document_id: document.id,
          status: "Processing",
          step: "Creating mock chunks",
          started_at: startedAt,
          updated_at: startedAt,
        })
        .select("id")
        .single();

      if (error) {
        throw new Error(`Unable to create processing job: ${error.message}`);
      }

      jobId = job.id;
    }

    const { error: processingStatusError } = await supabase
      .from("documents")
      .update({ status: "Processing", chunks_label: "Pending" })
      .eq("workspace_id", document.workspace_id)
      .eq("id", document.id);

    if (processingStatusError) {
      throw new Error(`Unable to mark document as processing: ${processingStatusError.message}`);
    }

    const { error: chunkDeleteError } = await supabase
      .from("document_chunks")
      .delete()
      .eq("workspace_id", document.workspace_id)
      .eq("document_id", document.id);

    if (chunkDeleteError) {
      throw new Error(`Unable to clear existing chunks: ${chunkDeleteError.message}`);
    }

    const { error: hierarchyDeleteError } = await supabase
      .from("document_hierarchy")
      .delete()
      .eq("workspace_id", document.workspace_id)
      .eq("document_id", document.id);

    if (hierarchyDeleteError) {
      throw new Error(`Unable to clear existing hierarchy: ${hierarchyDeleteError.message}`);
    }

    const mockChunks = createMockChunks(document);
    const { error: chunkInsertError } = await supabase
      .from("document_chunks")
      .insert(mockChunks);

    if (chunkInsertError) {
      throw new Error(`Unable to insert mock chunks: ${chunkInsertError.message}`);
    }

    const { error: hierarchyInsertError } = await supabase
      .from("document_hierarchy")
      .insert(createMockHierarchy(document));

    if (hierarchyInsertError) {
      throw new Error(`Unable to insert mock hierarchy: ${hierarchyInsertError.message}`);
    }

    const completedAt = new Date().toISOString();
    const { error: documentCompleteError } = await supabase
      .from("documents")
      .update({ status: "Processed", chunks_label: `${mockChunks.length} sections` })
      .eq("workspace_id", document.workspace_id)
      .eq("id", document.id);

    if (documentCompleteError) {
      throw new Error(`Unable to complete document processing: ${documentCompleteError.message}`);
    }

    const { error: jobCompleteError } = await supabase
      .from("processing_jobs")
      .update({
        status: "Processed",
        step: "Mock processing complete",
        error_message: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId);

    if (jobCompleteError) {
      throw new Error(`Unable to complete processing job: ${jobCompleteError.message}`);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      chunkCount: mockChunks.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mock processing failed.";
    const failedAt = new Date().toISOString();

    await supabase
      .from("documents")
      .update({ status: "Failed", chunks_label: "Pending" })
      .eq("workspace_id", document.workspace_id)
      .eq("id", document.id);

    if (jobId) {
      await supabase
        .from("processing_jobs")
        .update({
          status: "Failed",
          step: "Mock processing failed",
          error_message: message,
          completed_at: failedAt,
          updated_at: failedAt,
        })
        .eq("id", jobId);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
