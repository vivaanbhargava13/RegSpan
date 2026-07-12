# RegSpan v1 corpus

`manifest.json` defines the 12-case weak, partial, strong, and adversarial
evaluation corpus. Place locally generated or approved PDFs in `sources/` for
hand-authored fixtures or `generated/` for generated fixtures. Generated PDFs
are ignored by Git; no PDF is included in this repository.

Each case also declares an explicit client `sourceType`. This is evaluator
fixture metadata, passed through the normal upload path so extracted chunks are
classified as organization evidence without changing how ordinary uploads are
handled.

Run isolated cases after setting a local evaluation actor and explicit workspace
prefix:

```sh
REGSPAN_EVAL_ACTOR_USER_ID=<local-user-uuid> \
REGSPAN_EVAL_WORKSPACE_PREFIX=regspan-eval- \
npm run eval:corpus -- --mode isolated --allow-external-ai
```

Use `--mode combined` to process all combined-enabled PDFs in one run-specific
workspace. Every invocation creates new workspace names containing a unique
evaluation run ID and refuses to reuse existing names. There is no resume or
automatic cleanup mode. Failed or interrupted workspaces remain available for
manual inspection and later manual cleanup. `--timeout-ms` limits polling only;
it does not cancel synchronous Analysis generation. Artifacts are written under
ignored `eval-results/` without raw PDF text or source excerpts.

External AI must be explicitly enabled for each evaluation invocation with
`--allow-external-ai`, and the server-wide external AI setting must already be
enabled. The runner grants consent only while creating its own new
run-specific `regspan-eval-` workspaces; it never changes an existing workspace.
