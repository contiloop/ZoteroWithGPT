# Open limitations

## Independent Work execution

A direct Codex local-file client has completed the native study flow, but a distinct ChatGPT Work task has not been run. This matters only when offering Work as a tested replacement for Mac MCP. Account/tool availability and real local permissions cannot be established from Codex evidence. Validate on an actual user-started Work surface before advertising parity or usage behavior.

## Public Mac connection setup

The existing authenticated Mac Safe Files connection works for the validation user. Its public installer and supported distribution runbook are not available in this repository. A new user's end-to-end setup therefore cannot yet be promised from the XPI alone. Resolve with the connection owner or evaluate a separately approved transport; do not distribute private tunnel state.

## Same-user filesystem race

Gecko IOUtils does not expose a no-follow directory-handle read. A same-user attacker could replace a checked path before its open despite pre/post checks. This affects deployments that share the bridge with untrusted local processes. The current private-directory trust model excludes those attackers; stronger isolation requires another host filesystem primitive or process boundary, not a claim that the checks eliminate the race.

## Public distribution decision

Bundled dependencies have evaluated notices, but the project's own license and publication channel have not been selected. Public publication needs that decision and authorization. Local packaging and installation are available without asserting a public redistribution license.

## Ordinary ChatGPT Web activation remains incomplete

The private production plugin is installed, enabled, configured, and connected to Mac Safe Files. An ordinary 0.2.0 save request selected it but reached a subsequently repaired native import failure. Two fresh ordinary 0.2.1 conversations then returned no available Zotero integration without dispatching the workflow, despite the management UI showing the production plugin enabled and Mac Safe Files connected. These are observed activation failures; their cause has not been established. Version 0.2.2 account/source/connection readback succeeded. A further fresh ordinary 0.2.2 conversation after native removal/reinstall likewise reported no available Zotero integration after one natural save request; no bridge request was dispatched. Studying alone had also left the bridge unchanged. The required two complete ordinary-Web save conversations remain unmet. A direct local-client success, mandatory mention, pasted path, or manual connection prompt cannot replace that criterion. Preserve this blocker until new actual surface evidence resolves it.

## Native Zotero editor whitespace changes

During the owned 0.2.2 manual-conflict test, directly saving a manual marker in Zotero's native comment editor changed interior whitespace in the existing study body. Non-whitespace characters and the marker were preserved; the extension's earlier append had passed exact full-content readback. The subsequent stale extension update returned `conflict` and left the entire manually edited body unchanged. Keep this host-editor behavior separate from extension persistence; do not promise byte-preserving native UI edits or silently restore an older body after a person edits it.

## Historical uncertain operations

Two owned pre-fix acceptance operations remain terminal historical unknowns: one parent-creation attempt failed before native field initialization completed, and one annotation committed a body differing by a final newline. Public native initialization and precommit comment-representability fixes are now installed and separately verified. Those explanations do not rewrite terminal outcomes or authorize replay under a fresh identity. Preserve their journals and any existing native data.

## Resolved external preflight: arXiv metadata

The 2026-10-22 HTTP 429 preflight and the user's implementation deferral remain historical facts. Later actual production Zotero requests obtained concrete-version Atom metadata for 1706.03762v7 and 1607.06450v1, and the latter PDF was imported and locally parsed/fingerprinted. The metadata-access check is therefore no longer deferred. No cause is inferred for the earlier response, and no alternate endpoint or HTML metadata substitute established these passes. Continue respecting rate limits.
