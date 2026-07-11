# PDF processing hardening

## Threat model and execution boundary

Client PDFs are untrusted binary input. The relevant risks are malformed object
graphs, compressed or unusually large content, password protection, embedded
files, JavaScript/actions, XFA forms, large per-page text results, and parser work
that does not finish promptly.

The production flow is:

1. The browser upload route validates the 10 MiB size limit, `.pdf` name,
   `application/pdf` MIME type, and `%PDF-` signature.
2. The private object is stored in the workspace/document Storage path and a
   processing job is queued.
3. The authenticated internal worker downloads the object into memory and
   rechecks its size and type.
4. `extractPdfPages()` verifies the binary signature again and transfers the
   bytes to a dedicated Node worker thread.
5. The isolated worker loads PDF.js 5.4.296 from in-memory bytes, checks the page
   count and catalog, inspects active-content APIs, then extracts and normalizes
   text one page at a time.
6. Only a completely accepted array of normalized pages returns to the request
   thread. Chunking, optional synopsis generation, chunk persistence, and
   embeddings happen afterward.
7. Any parser rejection reaches `fail_ingestion_job_v1`, which atomically marks
   the processing job and document failed. A failed job cannot pass the
   completion RPC's `Processing` status check.

PDF.js parsing is asynchronous inside a dedicated `node:worker_threads` worker.
The worker has V8 resource limits (192 MiB old generation, 32 MiB young
generation, and a 4 MiB stack). Input bytes are transferred rather than copied.
The parent starts the worker from a fixed application-owned source string; no PDF
bytes, metadata, filenames, or other user input become executable worker source.

## Parser configuration

RegSpan invokes PDF.js with an in-memory `Uint8Array` only. It does not provide a
URL, document base URL, credentials, filesystem path, password, CMap URL, font
URL, or WASM URL. The configured options are:

- `isEvalSupported: false`
- `useWorkerFetch: false`
- `disableAutoFetch: true`
- `disableRange: true`
- `disableStream: true`
- `stopAtErrors: true`
- `enableXfa: false`
- `useSystemFonts: false`

`isEvalSupported: false` disables PDF.js dynamic code generation used to
accelerate PDF functions. RegSpan never creates PDF.js viewer scripting or
rendering components, so document JavaScript, launch actions, and form actions
are inspected but never executed.

## Accepted and rejected content

Normal static PDFs may contain text, fonts, images, static AcroForm fields, and
ordinary HTTP(S), mail, or telephone hyperlinks.

RegSpan rejects, using PDF.js catalog/page APIs rather than raw-byte searches:

- embedded files and file-attachment annotations;
- document, page, annotation, or AcroForm JavaScript actions;
- executable/file action targets exposed through annotations or outlines;
- named document open actions;
- XFA detected through PDF.js document metadata;
- password-protected or encrypted PDFs;
- malformed or unreadable PDF structures.

PDF.js does not expose the original action subtype for every catalog destination.
In particular, a document-level `Launch` action that PDF.js normalizes without an
observable action or unsafe target cannot be positively identified through its
public API. Such content is still not executed, and parsing remains isolated and
terminable. This is a residual detection limitation, not an execution path.

Calling `getAttachments()` can cause PDF.js to materialize attachment bytes in
the parser worker before RegSpan rejects the document. The file-size ceiling,
worker heap limits, and terminating deadline bound this residual risk.

Node worker `resourceLimits` constrain the V8 heap and stack, but they are not a
complete operating-system limit for native allocations or external
`ArrayBuffer` memory. Production should also enforce a container/function memory
limit. A process-level out-of-memory kill can bypass application cleanup and is a
residual platform risk.

## Resource limits

All values are server-only positive integers:

| Environment variable | Default | Purpose |
| --- | ---: | --- |
| `MAX_PDF_PAGES` | `250` | Reject before metadata inspection or page extraction. |
| `MAX_EXTRACTED_TEXT_CHARS` | `2000000` | Reject before chunks or embeddings when normalized document text exceeds the limit. |
| `MAX_PDF_PAGE_TEXT_CHARS` | `500000` | Bound one page's text assembly before normalization. |
| `PDF_PROCESSING_TIMEOUT_MS` | `30000` | Bound parser import, load, inspection, extraction, and normalization. |

The existing upload ceiling remains 10 MiB. Invalid configuration fails with a
safe server error and the normal failed-job transition. Text is never truncated;
the entire document is rejected instead.

PDF.js returns a page's text-item array as one promise, so RegSpan cannot stop
inside PDF.js while that single array is being produced. Per-item counting stops
RegSpan's own string assembly at the page limit, while worker memory and deadline
limits bound the preceding allocation.

## Timeout and cleanup guarantees

The request thread starts the deadline immediately after creating the isolated
worker. On timeout it removes listeners, clears the timer, and awaits
`Worker.terminate()` before returning `pdf_processing_timeout`. This is actual
worker-thread termination, not a `Promise.race` that leaves parser CPU work alive.
A late worker message cannot resolve the already failed request.

On success and parser-reported failure, the worker calls page cleanup after each
page, then document cleanup and `PDFDocumentLoadingTask.destroy()` before posting
its result. The request thread terminates the now-finished worker and clears the
deadline timer. Abrupt timeout relies on worker termination to release the
worker's parser state.

## Failure, retry, and observability

Safe categories include invalid signature, malformed PDF, password protection,
unsupported active content, page limit, per-page text limit, total text limit,
timeout, invalid configuration, and unexpected processing failure. Responses do
not include PDF.js messages, stacks, metadata, source text, bytes, paths, or
environment values.

Worker logs and audit events contain only identifiers, correlation ID, stage,
safe category, elapsed milliseconds, and a configured limit name/value when one
was exceeded. They do not contain filenames, Storage paths, extracted text, or
authentication material.

Parser failures do not persist chunks or embeddings because extraction completes
before either operation is called. `fail_ingestion_job_v1` changes active jobs
and the document to `Failed`; duplicate failure callbacks return false and do not
change terminal state. The completion RPC rejects any job not in `Processing`.

The private Storage object is intentionally retained after parser rejection. This
matches existing retry/reprocess and forensic-review behavior. Replacing or
deleting the document uses the existing authorized cleanup paths.

## Safe troubleshooting

Use the processing job's safe `error_message`, correlation ID, audit category,
and failing stage. Do not add PDF bytes, extracted text, parser exception strings,
or Storage paths to logs. A timeout can be reproduced in tests with an injected
worker that never sends a result; production configuration should not be lowered
merely to diagnose a malformed document.

## Manual local verification

1. Start RegSpan and the existing local n8n workflow with matching worker/HMAC
   secrets. Confirm the four PDF limit variables use positive integer values.
2. Upload a small valid PDF. Expect `Ready for Analysis`, a `Processed` job, and
   stored chunks/embeddings.
3. Rename a text file to `.pdf` and upload it. Expect an immediate 400 validation
   error, no Storage object, and no processing job.
4. Upload a `%PDF-` file truncated after its header. Expect the document and job
   to become `Failed`, with no chunks or embeddings.
5. Create a password-protected copy of a harmless local PDF using a trusted local
   PDF tool. Expect `Failed` and “Password-protected PDFs are not supported.” Do
   not use or upload a real client password.
6. Generate a harmless local PDF with 251 blank/text pages. Expect `Failed`, code
   `pdf_page_limit_exceeded`, and no chunks or embeddings.
7. In a local-only test environment, set `MAX_EXTRACTED_TEXT_CHARS` to a small
   positive value and upload a generated text PDF above it. Restore the variable,
   restart the app/worker, and expect `pdf_text_limit_exceeded` with no chunks.
8. Use the programmatic attachment fixture in `tests/pdf-processing.test.mjs` or
   create a harmless PDF containing an attached text file. Expect
   `pdf_unsupported_active_content`; never use unknown samples.
9. Run the controlled timeout test in `tests/pdf-processing.test.mjs`. It injects
   a worker that never responds, verifies one termination, and requires
   `pdf_processing_timeout`. No unsafe PDF is needed.
10. For each worker-side rejection, query `processing_jobs`, `documents`,
    `document_chunks`, and `chunk_embeddings` by the test document ID. The job and
    document must be `Failed`, chunk/embedding counts must be zero, and no later
    completion should appear. Reprocess or replace the document to verify the
    existing retry path remains available.
