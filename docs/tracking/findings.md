# Open limitations

## Independent Work execution

A direct Codex local-file client has completed the native study flow, but a distinct ChatGPT Work task has not been run. This matters only when offering Work as a tested replacement for Mac MCP. Account/tool availability and real local permissions cannot be established from Codex evidence. Validate on an actual user-started Work surface before advertising parity or usage behavior.

## Public Mac connection setup

The existing authenticated Mac Safe Files connection works for the validation user. Its public installer and supported distribution runbook are not available in this repository. A new user's end-to-end setup therefore cannot yet be promised from the XPI alone. Resolve with the connection owner or evaluate a separately approved transport; do not distribute private tunnel state.

## Same-user filesystem race

Gecko IOUtils does not expose a no-follow directory-handle read. A same-user attacker could replace a checked path before its open despite pre/post checks. This affects deployments that share the bridge with untrusted local processes. The current private-directory trust model excludes those attackers; stronger isolation requires another host filesystem primitive or process boundary, not a claim that the checks eliminate the race.

## Public distribution decision

Bundled dependencies have evaluated notices, but the project's own license and publication channel have not been selected. Public publication needs that decision and authorization. Local packaging and installation are available without asserting a public redistribution license.

## Current 0.3.0 selected-workflow acceptance is pending

The source and portable guidance define explicit plugin selection, offline `find_local_arxiv`, a current attachment fingerprint, and an actual local `read_pdf` before study. A lookup without a fingerprint stops for manual file or path restoration and fresh discovery; it does not call the shared reader as repair. This release cycle has not yet installed the 0.3.0 XPI, updated the private account plugin, run the selected Web conversation, performed a native mutation, or observed the saved comment in the reader. Package and direct-local checks cannot establish those surfaces. Complete the bounded checklist in `docs/operations.md` with a deliberately owned PDF before calling 0.3.0 accepted.

## Historical ordinary ChatGPT Web activation inconsistency

The private production plugin is installed, enabled, configured, and connected to Mac Safe Files. An ordinary 0.2.0 save request selected it but reached a subsequently repaired native import failure. Two fresh ordinary 0.2.1 conversations then returned no available Zotero integration without dispatching the workflow, despite the management UI showing the production plugin enabled and Mac Safe Files connected. These are observed activation failures; their cause has not been established. Version 0.2.2 account/source/connection readback succeeded. A further fresh ordinary 0.2.2 conversation after native removal/reinstall likewise reported no available Zotero integration after one natural save request; no bridge request was dispatched. Studying alone had also left the bridge unchanged. The required two complete ordinary-Web save conversations were not met under that workflow. A separate explicit-selection diagnostic using the owned plugin’s Try in chat action succeeded: the visible plugin selection invoked Mac Safe Files and sent only a read-only connection-status request, which confirmed the live 0.2.2 runtime. This establishes that explicit selection and tool binding worked; it does not establish implicit activation. Read-only source/account inspection found matching manifests, skill instructions, the exact app dependency, and implicit-invocation eligibility. Available tools did not expose the failed conversation’s supplied skill/tool set or selection reason, so no package defect or cache cause was established. Normal account Uninstall/Install later restored the same owned plugin, release, private configuration, enabled state, and Mac connection. One bounded fresh ordinary Web check after that materially changed installation state studied the absent exact Batch Normalization `1502.03167v1`. Its natural save request produced a complete proposed comment but no plugin dispatch or bridge request; no import or annotation was attempted. This is another observed activation failure, not an import or content-preservation failure. Preserve it as historical platform evidence. Decision 0004 makes visible explicit selection the 0.3.0 start, so future implicit activation is an optional convenience rather than a completion gate.

## Native Zotero editor whitespace changes

During the owned 0.2.2 manual-conflict test, directly saving a manual marker in Zotero's native comment editor changed interior whitespace in the existing study body. Non-whitespace characters and the marker were preserved; the extension's earlier append had passed exact full-content readback. The subsequent stale extension update returned `conflict` and left the entire manually edited body unchanged. Keep this host-editor behavior separate from extension persistence; do not promise byte-preserving native UI edits or silently restore an older body after a person edits it.

## Historical uncertain operations

Two owned pre-fix acceptance operations remain terminal historical unknowns: one parent-creation attempt failed before native field initialization completed, and one annotation committed a body differing by a final newline. Public native initialization and precommit comment-representability fixes are now installed and separately verified. Those explanations do not rewrite terminal outcomes or authorize replay under a fresh identity. Preserve their journals and any existing native data.

## Resolved external preflight: arXiv metadata

The 2026-10-22 HTTP 429 preflight and the user's implementation deferral remain historical facts. Later actual production Zotero requests obtained concrete-version Atom metadata for 1706.03762v7 and 1607.06450v1, and the latter PDF was imported and locally parsed/fingerprinted. The metadata-access check is therefore no longer deferred. No cause is inferred for the earlier response, and no alternate endpoint or HTML metadata substitute established these passes. Continue respecting rate limits.
