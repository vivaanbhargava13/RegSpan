# RegSpan environment matrix

All values are supplied at runtime. The container image is built without a live
environment file. `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are intentionally public and are injected into
the rendered HTML at request time; every other key or secret remains server-only.

Legend: **Different** means use environment-specific values. **n8n rotation**
means changing the value requires a coordinated n8n credential or workflow
change. Every runtime change requires an application restart unless noted.

## Core, auth, and ingestion

| Variable | Local | Staging | Production | Exposure | Format | Different | n8n rotation | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | development | required | required | Server | `development` or `production` | Yes | No | Runtime |
| `PORT` | Optional | Optional | Optional | Server | TCP port, default 3000 | No | No | Runtime |
| `HOSTNAME` | Optional | Optional | Optional | Server | Bind hostname, container uses `0.0.0.0` | No | No | Runtime |
| `NEXT_MANUAL_SIG_HANDLE` | Optional | Required by image | Required by image | Server | `true` | No | No | Runtime |
| `REGSPAN_SHUTDOWN_GRACE_MS` | Optional | Required, 330000 default | Required, 330000 default | Server | 61000-350000 ms; at least 60000 ms above PDF timeout and below platform grace | No | No | Runtime |
| `APP_BASE_URL` | Optional default localhost | Required | Required | Server/public URL | Exact HTTPS origin outside local | Yes | No | Runtime |
| `ALLOWED_AUTH_REDIRECT_ORIGINS` | Optional | Required | Required | Server | Comma-separated exact HTTPS origins | Yes | No | Runtime |
| `ALLOWED_APP_ORIGINS` | Required by mutation guard | Required | Required | Server | Comma-separated exact HTTPS origins | Yes | No | Runtime |
| `NEXT_PUBLIC_SUPABASE_URL` | Required for Supabase | Required | Required | Public | Exact Supabase HTTPS origin | Yes | No | Runtime/render |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required for Supabase | Required | Required | Public | Supabase anon/publishable key | Yes | No | Runtime/render |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for server APIs | Required | Required | **Secret, server-only** | Supabase service-role key, at least 32 characters | Yes | No | Runtime |
| `N8N_INGEST_WEBHOOK_URL` | Local HTTP allowed | Required | Required | Server | HTTPS production webhook URL | Yes | Workflow URL | Runtime |
| `N8N_INGEST_WEBHOOK_SECRET` | Required for ingestion | Required | Required | **Secret, server-only** | High-entropy 32+ characters | Yes | **Yes** | Runtime |
| `INGESTION_WORKER_SECRET` | Required for worker | Required | Required | **Secret, server-only** | Distinct high-entropy 32+ characters | Yes | **Yes** | Runtime |
| `REGSPAN_RATE_LIMIT_BACKEND` | Optional memory fallback | `supabase` | `supabase` | Server | Backend identifier | No | No | Runtime |
| `REGSPAN_REQUIRE_DURABLE_RATE_LIMITING` | Optional | Recommended true | Recommended true | Server | Boolean | No | No | Runtime |
| `NEXT_TELEMETRY_DISABLED` | Optional | Recommended `1` | Recommended `1` | Server | Boolean-like `1` | No | No | Build and runtime, non-secret |

## Abuse limits and quotas

These are optional locally because safe defaults exist. Staging and production
should set and review them explicitly. They are server-only positive integers,
may remain the same between environments, require restart, and do not require
n8n rotation.

| Variable | Default | Unit/window |
| --- | --- | --- |
| `REGSPAN_RATE_LIMIT_DOCUMENT_UPLOADS_PER_HOUR` | 12 | Requests/hour |
| `REGSPAN_RATE_LIMIT_DOCUMENT_REPLACES_PER_HOUR` | 12 | Requests/hour |
| `REGSPAN_RATE_LIMIT_DOCUMENT_REPROCESSES_PER_HOUR` | 30 | Requests/hour |
| `REGSPAN_RATE_LIMIT_DOCUMENT_BULK_ACTIONS_PER_HOUR` | 20 | Requests/hour |
| `REGSPAN_RATE_LIMIT_ANALYSIS_PER_HOUR` | 8 | Requests/hour |
| `REGSPAN_RATE_LIMIT_PASSWORD_RESETS_PER_15_MINUTES` | 5 | Requests/15 minutes |
| `REGSPAN_QUOTA_DOCUMENT_UPLOADS_PER_DAY` | 100 | Documents/day/workspace |
| `REGSPAN_QUOTA_UPLOAD_BYTES_PER_DAY` | 104857600 | Bytes/day/workspace |
| `REGSPAN_QUOTA_PROCESSING_REQUESTS_PER_HOUR` | 60 | Requests/hour/workspace |
| `REGSPAN_QUOTA_MAX_ACTIVE_PROCESSING_JOBS` | 2; staging recommendation 1 | Concurrent jobs/workspace |
| `REGSPAN_QUOTA_MAX_ACTIVE_ANALYSIS_RUNS` | 1 | Concurrent runs/workspace |

## PDF processing

All four variables are server-only, runtime-only, required explicitly by the
production preflight, may be shared across environments, and require restart.
They never require n8n credential rotation.

| Variable | Current value | Preflight bounds |
| --- | --- | --- |
| `MAX_PDF_PAGES` | 250 | 1-1000 pages |
| `MAX_EXTRACTED_TEXT_CHARS` | 2000000 | 20-10000000 characters |
| `MAX_PDF_PAGE_TEXT_CHARS` | 500000 | 20-2000000 and no more than total |
| `PDF_PROCESSING_TIMEOUT_MS` | 180000 | 1000-290000 ms and at least 60000 ms below shutdown grace |

## Feature and debug controls

| Variable | Required | Exposure | Format | Different | Restart | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| `ENABLE_MOCK_PROCESSING_ROUTE` | Optional; false production | Server | Boolean | No | Yes | Runtime |
| `ENABLE_INTERNAL_DEBUG_ROUTES` | Optional; false production | Server | Boolean | No | Yes | Runtime |
| `ENABLE_EXTERNAL_AI_PROCESSING` | Optional; false default | Server | Boolean | Possibly | Yes | Runtime |
| `ENABLE_EXTERNAL_AI_CLASSIFIER` | Optional; false default | Server | Boolean; requires processing flag | Possibly | Yes | Runtime |

## External AI configuration

External calls still require workspace consent. Models/providers are
server-only configuration; API keys are secrets. Values should differ between
staging and production where provider isolation supports it. Changes require an
application restart but no n8n change.

| Variable | Required | Exposure | Expected format | Phase |
| --- | --- | --- | --- | --- |
| `EMBEDDING_PROVIDER` | When external AI enabled | Server | `openai` | Runtime |
| `EMBEDDING_MODEL` | When external AI enabled | Server | Provider model identifier | Runtime |
| `EMBEDDING_API_KEY` | When external AI enabled | **Secret, server-only** | High-entropy provider key | Runtime |
| `OPENAI_API_KEY` | Optional fallback | **Secret, server-only** | High-entropy provider key | Runtime |
| `CHUNK_SYNOPSIS_MODEL` | Optional | Server | Provider model identifier | Runtime |
| `CHUNK_SYNOPSIS_API_KEY` | Optional/fallback | **Secret, server-only** | High-entropy provider key | Runtime |
| `REQUIREMENT_CLASSIFIER_PROVIDER` | Optional | Server | `heuristic` or `openai` | Runtime |
| `REQUIREMENT_CLASSIFIER_MODEL` | Required for enabled OpenAI classifier | Server | Provider model identifier | Runtime |
| `REQUIREMENT_CLASSIFIER_API_KEY` | Required or fallback for classifier | **Secret, server-only** | High-entropy provider key | Runtime |

No `NEXT_PUBLIC_` variant of a service-role, n8n, worker, embedding, classifier,
synopsis, or OpenAI secret is permitted.

## Development utilities

These variables are optional, local-only inputs for repository scripts. They
are not copied into the runtime image, are never needed at build time, do not
require n8n coordination, and should differ whenever they identify an
environment-specific workspace or file.

| Variable | Consumer | Exposure | Expected format | Restart |
| --- | --- | --- | --- | --- |
| `SEC_REGSP_PDF_PATH` | Regulatory-source import script | Local developer process | Local PDF path | No application restart |
| `RETRIEVAL_EVAL_WORKSPACE_ID` | Retrieval evaluation script | Local developer process | Staging/local workspace UUID | No application restart |
| `RETRIEVAL_EVAL_WORKSPACE_NAME` | Retrieval evaluation script | Local developer process | Workspace display name | No application restart |
| `REQUIREMENT_EVAL_WORKSPACE_ID` | Requirement evaluation script | Local developer process | Staging/local workspace UUID | No application restart |
| `REQUIREMENT_EVAL_WORKSPACE_NAME` | Requirement evaluation script | Local developer process | Workspace display name | No application restart |
