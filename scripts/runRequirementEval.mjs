#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  buildRequirementEvalReport,
  formatRequirementEvalMarkdown,
} from "./requirementEvalReport.mjs";

const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_TOP_K = 15;
const DEFAULT_OUTPUT_DIR = "eval-results";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function printUsage() {
  console.log(`RegSpan requirement matching eval

Usage:
  npm run eval:requirements -- [options]

Options:
  --workspace-id <uuid>       Workspace to evaluate. If omitted, the script uses
                              REQUIREMENT_EVAL_WORKSPACE_ID or auto-selects only
                              when exactly one workspace exists.
  --workspace-name <name>     Workspace name to evaluate when a UUID is awkward
                              to pass through the shell.
  --top-k <number>            Retrieval candidates per requirement. Defaults to ${DEFAULT_TOP_K}.
  --requirement-id <id>       Optional single canonical requirement id.
  --out-dir <path>            Output directory. Defaults to ${DEFAULT_OUTPUT_DIR}.
  --help                      Show this help.

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
    topK: DEFAULT_TOP_K,
    requirementId: null,
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
    if (arg === "--top-k") {
      args.topK = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--requirement-id") {
      args.requirementId = next ?? null;
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

async function loadTypeScriptModule(sourcePath, outDir) {
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: sourcePath,
  });
  const outputPath = join(outDir, sourcePath.replace(/[\/:]/g, "__").replace(/\.ts$/, ".mjs"));
  const outputText = transpiled.outputText
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"');
  await writeFile(outputPath, outputText, "utf8");
  return import(pathToFileURL(outputPath).href);
}

async function loadRequirementMatchingModules() {
  const outDir = await mkdtemp(join(tmpdir(), "regspan-requirement-eval-"));
  const [, requirements, matching, source, reranking] = await Promise.all([
    loadTypeScriptModule("lib/negativeEvidence.ts", outDir),
    loadTypeScriptModule("lib/regSpRequirements.ts", outDir),
    loadTypeScriptModule("lib/requirementMatching.ts", outDir),
    loadTypeScriptModule("lib/documentSource.ts", outDir),
    loadTypeScriptModule("lib/hybridReranking.ts", outDir),
  ]);

  return {
    REG_SP_REQUIREMENTS: requirements.REG_SP_REQUIREMENTS,
    getRegSpRequirement: requirements.getRegSpRequirement,
    buildRequirementMatchResult: matching.buildRequirementMatchResult,
    inferDocumentSourceType: source.inferDocumentSourceType,
    inferEvidenceRole: source.inferEvidenceRole,
    evidenceRoleForSourceType: source.evidenceRoleForSourceType,
    buildRequirementKeywordProfile: reranking.buildRequirementKeywordProfile,
    mergeHybridCandidates: reranking.mergeHybridCandidates,
    rerankRequirementCandidates: reranking.rerankRequirementCandidates,
  };
}

async function resolveWorkspace(supabase, suppliedWorkspaceId, suppliedWorkspaceName) {
  const envWorkspaceId = process.env.REQUIREMENT_EVAL_WORKSPACE_ID?.trim() || null;
  const envWorkspaceName = process.env.REQUIREMENT_EVAL_WORKSPACE_NAME?.trim() || null;
  const workspaceId = suppliedWorkspaceId || envWorkspaceId;
  if (workspaceId) {
    assertUuid(workspaceId, "workspace_id");
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) {
      throw new Error(`Unable to look up workspace by id: ${error.message}`);
    }
    return { id: workspaceId, name: data?.name ?? null };
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
      return { id: data[0].id, name: data[0].name ?? null };
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
    return { id: data[0].id, name: data[0].name ?? null };
  }

  const available = (data ?? [])
    .map((workspace) => `- ${workspace.id} (${workspace.name ?? "Unnamed workspace"})`)
    .join("\n");
  throw new Error(
    `Pass --workspace-id <uuid>, --workspace-name <name>, or set REQUIREMENT_EVAL_WORKSPACE_ID.\nAvailable workspaces:\n${available || "- none found"}`,
  );
}

async function createQueryEmbedding(query, { provider, model, apiKey }) {
  if (provider !== "openai") {
    throw new Error("Only EMBEDDING_PROVIDER=openai is supported by the requirement eval runner.");
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

function normalizeKeywordText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordRowText(row) {
  const metadata = row.metadata ?? {};
  return normalizeKeywordText([
    row.content,
    row.section_path,
    metadata.section_path,
    metadata.section_heading,
    metadata.parent_heading,
    metadata.evidence_reason,
  ].filter(Boolean).join(" "));
}

function countKeywordMatches(text, terms) {
  return terms.filter((term) => text.includes(normalizeKeywordText(term))).length;
}

function escapeIlikeTerm(term) {
  return term.replace(/[,%]/g, " ").trim();
}

async function fetchKeywordRows({ supabase, workspaceId, terms, limit }) {
  const queryTerms = terms
    .map(escapeIlikeTerm)
    .filter((term) => term.length >= 4)
    .slice(0, 12);
  const selectColumns = "id, document_id, chunk_index, content, metadata, page_start, page_end, section_path";

  if (queryTerms.length > 0) {
    const clauses = queryTerms.flatMap((term) => [
      `content.ilike.%${term}%`,
      `section_path.ilike.%${term}%`,
    ]);
    const { data, error } = await supabase
      .from("document_chunks")
      .select(selectColumns)
      .eq("workspace_id", workspaceId)
      .or(clauses.join(","))
      .limit(Math.max(limit * 4, 80));

    if (!error) {
      return data ?? [];
    }
  }

  const { data, error } = await supabase
    .from("document_chunks")
    .select(selectColumns)
    .eq("workspace_id", workspaceId)
    .limit(Math.max(limit * 4, 120));

  if (error) {
    throw new Error(`Keyword retrieval failed: ${error.message}`);
  }

  return data ?? [];
}

async function hydrateRetrievedRows({
  supabase,
  sourceClassifier,
  workspaceId,
  rows,
  semanticRanked = false,
}) {
  if (rows.length === 0) {
    return [];
  }

  const chunkIds = rows.map((row) => row.chunk_id ?? row.id);
  const documentIds = Array.from(new Set(rows.map((row) => row.document_id)));
  const needsMetadata = rows.some((row) => row.metadata === undefined);
  const metadataPromise = needsMetadata
    ? supabase
        .from("document_chunks")
        .select("id, metadata")
        .eq("workspace_id", workspaceId)
        .in("id", chunkIds)
    : Promise.resolve({ data: rows.map((row) => ({ id: row.id, metadata: row.metadata ?? {} })), error: null });
  const [{ data: metadataRows, error: metadataError }, { data: documentRows, error: documentsError }] = await Promise.all([
    metadataPromise,
    supabase
      .from("documents")
      .select("id, filename, document_type, notes")
      .eq("workspace_id", workspaceId)
      .in("id", documentIds),
  ]);

  if (metadataError) {
    throw new Error(`Retrieved chunk metadata could not be loaded: ${metadataError.message}`);
  }
  if (documentsError) {
    throw new Error(`Retrieved document metadata could not be loaded: ${documentsError.message}`);
  }

  const metadataById = new Map(
    (metadataRows ?? []).map((row) => [row.id, row.metadata ?? {}]),
  );
  const documentsById = new Map(
    (documentRows ?? []).map((document) => [document.id, document]),
  );

  return rows.map((row, index) => {
    const chunkId = row.chunk_id ?? row.id;
    const metadata = row.metadata ?? metadataById.get(chunkId) ?? {};
    const document = documentsById.get(row.document_id);
    const evidenceReason = typeof metadata.evidence_reason === "string"
      ? metadata.evidence_reason
      : null;
    const embeddingInput = typeof metadata.embedding_input === "string"
      ? metadata.embedding_input
      : null;
    const contentPreview = row.content_preview ?? row.content ?? "";
    const sourceType = sourceClassifier.inferDocumentSourceType({
      filename: document?.filename ?? row.filename,
      documentType: document?.document_type,
      notes: document?.notes,
      sectionPath: row.section_path,
      contentPreview,
      evidenceReason,
    });
    const evidenceRole = sourceClassifier.inferEvidenceRole({
      filename: document?.filename ?? row.filename,
      documentType: document?.document_type,
      notes: document?.notes,
      sectionPath: row.section_path,
      contentPreview,
      evidenceReason,
    });

    return {
      chunk_id: chunkId,
      document_id: row.document_id,
      filename: document?.filename ?? row.filename ?? null,
      page_start: row.page_start ?? null,
      page_end: row.page_end ?? null,
      chunk_index: row.chunk_index,
      section_path: row.section_path ?? null,
      content_preview: contentPreview,
      similarity: typeof row.similarity === "number" ? row.similarity : 0,
      rank: semanticRanked ? index + 1 : null,
      evidence_reason: evidenceReason,
      embedding_input: embeddingInput,
      source_type: sourceType,
      evidence_role: evidenceRole,
      rerank_score: null,
      rerank_reason: null,
    };
  });
}

async function retrieveRequirementCandidates({
  supabase,
  embeddingConfig,
  sourceClassifier,
  hybridReranker,
  workspaceId,
  topK,
  requirement,
}) {
  const queryEmbedding = await createQueryEmbedding(requirement.retrievalQuery, embeddingConfig);
  const { data, error } = await supabase.rpc("match_document_chunks_v1", {
    p_workspace_id: workspaceId,
    p_query_embedding: queryEmbedding,
    p_top_k: Math.max(topK, 30),
    p_document_id: null,
    p_embedding_model: embeddingConfig.model,
  });

  if (error) {
    throw new Error(`Retrieval RPC failed for ${requirement.id}: ${error.message}`);
  }

  const semanticCandidates = await hydrateRetrievedRows({
    supabase,
    sourceClassifier,
    workspaceId,
    rows: data ?? [],
    semanticRanked: true,
  });
  const profile = hybridReranker.buildRequirementKeywordProfile(requirement);
  const keywordRows = await fetchKeywordRows({
    supabase,
    workspaceId,
    terms: profile.keywordTerms,
    limit: 40,
  });
  const rankedKeywordRows = keywordRows
    .map((row) => ({
      row,
      matchCount: countKeywordMatches(keywordRowText(row), profile.keywordTerms),
    }))
    .filter((item) => item.matchCount > 0)
    .sort((left, right) => right.matchCount - left.matchCount)
    .slice(0, 40)
    .map((item) => item.row);
  const keywordCandidates = await hydrateRetrievedRows({
    supabase,
    sourceClassifier,
    workspaceId,
    rows: rankedKeywordRows,
  });
  const mergedCandidates = hybridReranker.mergeHybridCandidates(semanticCandidates, keywordCandidates);

  return hybridReranker.rerankRequirementCandidates(requirement, mergedCandidates, topK);
}

function selectRequirements({ requirementId, REG_SP_REQUIREMENTS, getRegSpRequirement }) {
  if (!requirementId) {
    return REG_SP_REQUIREMENTS;
  }

  const requirement = getRegSpRequirement(requirementId);
  if (!requirement) {
    throw new Error(`Unknown requirement id: ${requirementId}`);
  }
  return [requirement];
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
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const embeddingConfig = {
    provider: requireEnv("EMBEDDING_PROVIDER").toLowerCase(),
    model: requireEnv("EMBEDDING_MODEL"),
    apiKey: requireEnv("EMBEDDING_API_KEY"),
  };
  const {
    REG_SP_REQUIREMENTS,
    getRegSpRequirement,
    buildRequirementMatchResult,
    inferDocumentSourceType,
    inferEvidenceRole,
    evidenceRoleForSourceType,
    buildRequirementKeywordProfile,
    mergeHybridCandidates,
    rerankRequirementCandidates,
  } = await loadRequirementMatchingModules();
  const requirements = selectRequirements({
    requirementId: args.requirementId,
    REG_SP_REQUIREMENTS,
    getRegSpRequirement,
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workspace = await resolveWorkspace(supabase, args.workspaceId, args.workspaceName);
  const generatedAt = new Date().toISOString();

  console.info("[RegSpan eval] Starting requirement matching evaluation", {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    topK,
    requirementCount: requirements.length,
    requirementId: args.requirementId ?? "all",
  });

  const results = [];
  for (const requirement of requirements) {
    console.info(`[RegSpan eval] Requirement ${requirement.id}`);
    const chunks = await retrieveRequirementCandidates({
      supabase,
      embeddingConfig,
      sourceClassifier: { inferDocumentSourceType, inferEvidenceRole, evidenceRoleForSourceType },
      hybridReranker: {
        buildRequirementKeywordProfile,
        mergeHybridCandidates,
        rerankRequirementCandidates,
      },
      workspaceId: workspace.id,
      topK,
      requirement,
    });
    results.push(buildRequirementMatchResult(requirement, chunks));
  }

  const report = buildRequirementEvalReport({
    generatedAt,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    topK,
    requirementId: args.requirementId ?? "all",
    results,
  });

  const outDir = resolve(args.outDir || DEFAULT_OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "requirement-eval-latest.json");
  const markdownPath = resolve(outDir, "requirement-eval-latest.md");

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, formatRequirementEvalMarkdown(report), "utf8"),
  ]);

  console.info("[RegSpan eval] Requirement matching evaluation complete", {
    jsonPath,
    markdownPath,
  });
}

main().catch((error) => {
  console.error("[RegSpan eval] Requirement matching evaluation failed", {
    error: error instanceof Error ? error.message : "unknown_error",
  });
  process.exitCode = 1;
});
