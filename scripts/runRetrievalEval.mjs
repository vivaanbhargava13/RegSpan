#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildRetrievalEvalReport,
  formatRetrievalEvalMarkdown,
  MANUAL_RETRIEVAL_EVAL_QUERIES,
  shapeRetrievalEvalResult,
} from "./retrievalEvalReport.mjs";

const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_TOP_K = 10;
const DEFAULT_OUTPUT_DIR = "eval-results";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function printUsage() {
  console.log(`RegSpan retrieval eval

Usage:
  npm run eval:retrieval -- [options]

Options:
  --workspace-id <uuid>   Workspace to evaluate. If omitted, the script uses
                          RETRIEVAL_EVAL_WORKSPACE_ID or auto-selects only
                          when exactly one workspace exists.
  --workspace-name <name> Workspace name to evaluate when a UUID is awkward to
                          pass through the shell.
  --document-id <uuid>    Optional document filter.
  --top-k <number>        Results per query. Defaults to ${DEFAULT_TOP_K}.
  --out-dir <path>        Output directory. Defaults to ${DEFAULT_OUTPUT_DIR}.
  --help                  Show this help.

Required existing server env:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  EMBEDDING_PROVIDER=openai
  EMBEDDING_MODEL
  EMBEDDING_API_KEY
`);
}

function parseArgs(argv) {
  const args = {
    workspaceId: null,
    workspaceName: null,
    documentId: null,
    topK: DEFAULT_TOP_K,
    outDir: DEFAULT_OUTPUT_DIR,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--workspace-id") {
      args.workspaceId = next ?? null;
      index += 1;
      continue;
    }
    if (arg === "--workspace-name") {
      args.workspaceName = next ?? null;
      index += 1;
      continue;
    }
    if (arg === "--document-id") {
      args.documentId = next ?? null;
      index += 1;
      continue;
    }
    if (arg === "--top-k") {
      args.topK = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      args.outDir = next ?? DEFAULT_OUTPUT_DIR;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

async function loadEnvFile(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}.`);
  }
  return value;
}

function requireExternalAiProcessingEnabled() {
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.trim().toLowerCase() !== "true") {
    throw new Error(
      "External AI processing is disabled by server policy. Set ENABLE_EXTERNAL_AI_PROCESSING=true to run retrieval evaluation embeddings.",
    );
  }
}

function assertUuid(value, label) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
}

function validateTopK(value) {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error("top_k must be an integer from 1 through 50.");
  }
  return value;
}

async function resolveWorkspaceId(supabase, suppliedWorkspaceId, suppliedWorkspaceName) {
  const envWorkspaceId = process.env.RETRIEVAL_EVAL_WORKSPACE_ID?.trim() || null;
  const envWorkspaceName = process.env.RETRIEVAL_EVAL_WORKSPACE_NAME?.trim() || null;
  const workspaceId = suppliedWorkspaceId || envWorkspaceId;
  if (workspaceId) {
    assertUuid(workspaceId, "workspace_id");
    return workspaceId;
  }

  const workspaceName = suppliedWorkspaceName || envWorkspaceName;
  if (workspaceName) {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("name", workspaceName)
      .limit(2);

    if (error) {
      throw new Error(`Unable to look up workspace by name: ${error.message}`);
    }
    if ((data ?? []).length === 1) {
      return data[0].id;
    }
    throw new Error(
      `Workspace name "${workspaceName}" matched ${(data ?? []).length} workspaces. Pass --workspace-id <uuid> instead.`,
    );
  }

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    throw new Error(`Unable to discover workspaces: ${error.message}`);
  }

  if ((data ?? []).length === 1) {
    return data[0].id;
  }

  const available = (data ?? [])
    .map((workspace) => `- ${workspace.id} (${workspace.name ?? "Unnamed workspace"})`)
    .join("\n");
  throw new Error(
    `Pass --workspace-id <uuid>, --workspace-name <name>, or set RETRIEVAL_EVAL_WORKSPACE_ID.\nAvailable workspaces:\n${available || "- none found"}`,
  );
}

async function createQueryEmbedding(query, { provider, model, apiKey }) {
  if (provider !== "openai") {
    throw new Error("Only EMBEDDING_PROVIDER=openai is supported by the eval runner.");
  }

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [query],
      model,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding provider request failed with status ${response.status}.`);
  }

  const body = await response.json();
  const embedding = body?.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error("Embedding provider returned an invalid query vector.");
  }

  return embedding;
}

async function retrieveEvalResults({
  supabase,
  embeddingConfig,
  workspaceId,
  documentId,
  topK,
  query,
}) {
  const queryEmbedding = await createQueryEmbedding(query, embeddingConfig);
  const { data, error } = await supabase.rpc("match_document_chunks_v1", {
    p_workspace_id: workspaceId,
    p_query_embedding: queryEmbedding,
    p_top_k: topK,
    p_document_id: documentId,
    p_embedding_model: embeddingConfig.model,
  });

  if (error) {
    throw new Error(`Retrieval RPC failed: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return [];
  }

  const chunkIds = rows.map((row) => row.chunk_id);
  const { data: metadataRows, error: metadataError } = await supabase
    .from("document_chunks")
    .select("id, metadata")
    .eq("workspace_id", workspaceId)
    .in("id", chunkIds);

  if (metadataError) {
    throw new Error(`Retrieved chunk metadata could not be loaded: ${metadataError.message}`);
  }

  const metadataById = new Map(
    (metadataRows ?? []).map((row) => [row.id, row.metadata ?? {}]),
  );

  return rows.map((row, index) => {
    const metadata = metadataById.get(row.chunk_id) ?? {};
    return shapeRetrievalEvalResult(
      {
        ...row,
        evidence_reason: typeof metadata.evidence_reason === "string"
          ? metadata.evidence_reason
          : null,
        embedding_input: typeof metadata.embedding_input === "string"
          ? metadata.embedding_input
          : null,
      },
      index + 1,
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  await loadEnvFile(resolve(".env.local"));
  await loadEnvFile(resolve(".env"));

  const topK = validateTopK(args.topK);
  if (args.documentId) {
    assertUuid(args.documentId, "document_id");
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  requireExternalAiProcessingEnabled();
  const embeddingConfig = {
    provider: requireEnv("EMBEDDING_PROVIDER").toLowerCase(),
    model: requireEnv("EMBEDDING_MODEL"),
    apiKey: requireEnv("EMBEDDING_API_KEY"),
  };

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workspaceId = await resolveWorkspaceId(supabase, args.workspaceId, args.workspaceName);
  const documentId = args.documentId || null;
  const generatedAt = new Date().toISOString();

  console.info("[RegSpan eval] Starting retrieval evaluation", {
    workspaceId,
    documentId,
    topK,
    queryCount: MANUAL_RETRIEVAL_EVAL_QUERIES.length,
  });

  const queries = [];
  for (const querySpec of MANUAL_RETRIEVAL_EVAL_QUERIES) {
    console.info(`[RegSpan eval] Query ${querySpec.id}/${MANUAL_RETRIEVAL_EVAL_QUERIES.length}`);
    const results = await retrieveEvalResults({
      supabase,
      embeddingConfig,
      workspaceId,
      documentId,
      topK,
      query: querySpec.query,
    });
    queries.push({ ...querySpec, results });
  }

  const report = buildRetrievalEvalReport({
    generatedAt,
    workspaceId,
    documentId,
    topK,
    queries,
  });

  const outDir = resolve(args.outDir || DEFAULT_OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "retrieval-eval-latest.json");
  const markdownPath = resolve(outDir, "retrieval-eval-latest.md");

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, formatRetrievalEvalMarkdown(report), "utf8"),
  ]);

  console.info("[RegSpan eval] Retrieval evaluation complete", {
    jsonPath,
    markdownPath,
  });
}

main().catch((error) => {
  console.error("[RegSpan eval] Retrieval evaluation failed", {
    error: error instanceof Error ? error.message : "unknown_error",
  });
  process.exitCode = 1;
});
