import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRetrievalEvalReport,
  formatPageRange,
  formatRetrievalEvalMarkdown,
  MANUAL_RETRIEVAL_EVAL_QUERIES,
  shapeRetrievalEvalResult,
} from "../scripts/retrievalEvalReport.mjs";

test("retrieval eval query set loads the ten manual evaluation questions", () => {
  assert.equal(MANUAL_RETRIEVAL_EVAL_QUERIES.length, 10);
  assert.equal(
    MANUAL_RETRIEVAL_EVAL_QUERIES[0].query,
    "What procedures exist for notifying affected customers after unauthorized access?",
  );
  assert.equal(
    MANUAL_RETRIEVAL_EVAL_QUERIES[9].query,
    "How are vulnerabilities remediated and tracked?",
  );
  assert.ok(MANUAL_RETRIEVAL_EVAL_QUERIES.every((item) => item.expected.length > 20));
});

test("retrieval eval result shaping captures citation and debug fields", () => {
  const shaped = shapeRetrievalEvalResult(
    {
      filename: "Incident Response.pdf",
      document_id: "11111111-1111-4111-8111-111111111111",
      page_start: 4,
      page_end: 5,
      chunk_index: 12,
      section_path: "Incident Response > Customer Notification",
      similarity: 0.812345,
      evidence_reason: "substantive policy evidence",
      content_preview: "Affected customers must be notified after unauthorized access.",
      embedding_input: "Filename: Incident Response.pdf\nSection: Incident Response > Customer Notification",
    },
    2,
  );

  assert.equal(shaped.rank, 2);
  assert.equal(shaped.filename, "Incident Response.pdf");
  assert.equal(shaped.page_start, 4);
  assert.equal(shaped.page_end, 5);
  assert.equal(shaped.chunk_index, 12);
  assert.equal(shaped.section_path, "Incident Response > Customer Notification");
  assert.equal(shaped.similarity, 0.812345);
  assert.match(shaped.evidence_reason, /policy evidence/);
  assert.match(shaped.content_preview, /Affected customers/);
  assert.match(shaped.embedding_input_preview, /Filename/);
});

test("retrieval eval markdown includes summary and manual reviewer fields", () => {
  const report = buildRetrievalEvalReport({
    generatedAt: "2026-06-24T00:00:00.000Z",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    documentId: null,
    topK: 10,
    queries: [
      {
        ...MANUAL_RETRIEVAL_EVAL_QUERIES[0],
        results: [
          shapeRetrievalEvalResult(
            {
              filename: "Incident Response.pdf",
              document_id: "11111111-1111-4111-8111-111111111111",
              page_start: 7,
              page_end: 7,
              chunk_index: 3,
              section_path: "Incident Response > Notification",
              similarity: 0.9,
              evidence_reason: "substantive policy evidence",
              content_preview: "Notify affected customers.",
              embedding_input: "Filename: Incident Response.pdf",
            },
            1,
          ),
        ],
      },
    ],
  });

  const markdown = formatRetrievalEvalMarkdown(report);

  assert.match(markdown, /# RegSpan retrieval evaluation report/);
  assert.match(markdown, /Queries run: 1/);
  assert.match(markdown, /Top K: 10/);
  assert.match(markdown, /Average similarity/);
  assert.match(markdown, /Top result relevant:/);
  assert.match(markdown, /Top 3 relevant:/);
  assert.match(markdown, /Best document:/);
  assert.match(markdown, /Best page range:/);
  assert.match(markdown, /Problem noticed:/);
  assert.match(markdown, /Verdict:/);
  assert.match(markdown, /Embedding input preview/);
  assert.equal(formatPageRange(7, 7), "Page 7");
});

test("retrieval eval runner writes gitignored latest JSON and Markdown paths", async () => {
  const [runner, gitignore, packageJson] = await Promise.all([
    readFile("scripts/runRetrievalEval.mjs", "utf8"),
    readFile(".gitignore", "utf8"),
    readFile("package.json", "utf8"),
  ]);

  assert.match(runner, /retrieval-eval-latest\.json/);
  assert.match(runner, /retrieval-eval-latest\.md/);
  assert.match(runner, /match_document_chunks_v1/);
  assert.match(runner, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(runner, /requireExternalAiProcessingEnabled/);
  assert.match(runner, /ENABLE_EXTERNAL_AI_PROCESSING=true/);
  assert.match(runner, /--workspace-name/);
  assert.match(gitignore, /eval-results\//);
  assert.match(packageJson, /"eval:retrieval": "node scripts\/runRetrievalEval\.mjs"/);
});
