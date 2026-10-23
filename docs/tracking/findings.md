# Open limitations

## 0.3.1 source preparation can rewrite or omit captured conversation blocks

The first actual 0.3.1 selected conversation proved that complete preservation is possible: its independently captured visible user and assistant blocks occurred exactly in the create request, and the request, result, and fresh native body were byte-identical. The second fresh selected conversation did not preserve the same boundary.

In the failed ResNet save, request preparation removed the 139-character selected-plugin and arXiv Markdown-link prefix from the 506-character visible user source. The remaining user text changed from 367 to 370 characters because three backslashes were added before `frac` tokens; the separately captured 109-character candidate choice stayed exact. The 3,591-character assistant source became a 3,389-character request block. It gained prose emphasis, changed Markdown-table spacing and the delimiter row, replaced a labeled query-bearing Highway Networks link with a bare URL, and omitted the final 70-character historical read-only status paragraph plus its two-character separator. These changes exceed the allowed lossless mathematics, Unicode-normalization, and block-boundary presentation mapping.

The resulting 3,898-character create request, create result, and fresh native body were exactly equal, and the actual Zotero reader showed the correct page-3 highlight, reference URL, and final stored conclusion. The prior annotation remained unchanged. The defect is therefore in conversational source preparation before the native request, rather than target selection, approval, bridge transport, native storage, or reader display. The user's ordinary save request was explicit, and exactly one correctly targeted create occurred.

Annotation `2WYFHJ28`, operation `study.write.20261023.save05`, and their request, result, and journal are preserved as failed evidence. Do not retry, replace, patch, or reidentify that write. Acceptance requires a reviewed general source-preparation correction that uses the complete accessible requested user and assistant blocks by default, followed by a fresh actual selected-Web source-to-request-to-native comparison. Topic-level or section-level checks are insufficient.

## Independent Work execution

A direct Codex local-file client has completed the native study flow, but a distinct ChatGPT Work task has not been run. This matters only when offering Work as a tested replacement for Mac MCP. Account/tool availability and real local permissions cannot be established from Codex evidence. Validate on an actual user-started Work surface before advertising parity or usage behavior.

## Public Mac connection setup

The existing authenticated Mac Safe Files connection works for the validation user. Its public installer and supported distribution runbook are not available in this repository. A new user's end-to-end setup therefore cannot yet be promised from the XPI alone. Resolve with the connection owner or evaluate a separately approved transport; do not distribute private tunnel state.

## Same-user filesystem race

Gecko IOUtils does not expose a no-follow directory-handle read. A same-user attacker could replace a checked path before its open despite pre/post checks. This affects deployments that share the bridge with untrusted local processes. The current private-directory trust model excludes those attackers; stronger isolation requires another host filesystem primitive or process boundary, not a claim that the checks eliminate the race.

## Public distribution decision

Bundled dependencies have evaluated notices, but the project's own license and publication channel have not been selected. Public publication needs that decision and authorization. Local packaging and installation are available without asserting a public redistribution license.

## Reader-backed request can starve the serialized bridge

During the first 0.3.0 actual-runtime attempt, read-only `list_annotations` operation `t5-direct-layernorm-before-web-annotations-1` remained durable `running`, produced no result, and prevented a later Web `connection_status` request in the same serialized scanner from progressing. No mutation was submitted. The initial recovery used normal Quit/relaunch and did not copy the later request into the fresh session.

Recovery terminalized the interrupted read-only operation as `indeterminate/unknown_outcome` with the mutation-oriented text “No native object carries the historical operation identity; the write must not be retried blindly.” The conservative state is safe, but the reference to a write is misleading for a read-only operation and should be corrected when recovery messaging is next changed.

The pending native stage was not established. The first JavaScript stage probe was unevaluated because the runner contained appended text and hit a redeclaration error. A later clean cold-reader probe began with a restored but unselected owned PDF and an empty reader registry; `Reader.open`, registry acquisition, `_initPromise`, and `view.initializedPromise` all completed within 683 ms. It did not reproduce the hang. During an earlier diagnostic restart, normal Quit left the diagnostic UI unresponsive and one Activity Monitor Force Quit was used; the initial recovery and later diagnostic recovery are separate events. No write request or unsaved-work prompt was present.

Treat the original stall as confirmed and its cause as unresolved. A finite bound around native reader acquisition remains a resilience improvement because one stuck reader-backed handler can block later bridge work, but the clean probe does not justify a speculative root-cause fix.

## Viewer verification depends on an active attachment reader

The second selected-Web save returned native storage confirmed, but its immediate `verify_annotation` reported `attachment_reader_missing`. This failure did not authorize another create. Opening the owned attachment through normal Zotero UI then displayed the saved annotation, selected the exact passage on page 3, and confirmed the full comment. Keep the failed protocol observation and later actual-reader success as separate evidence; do not reclassify the initial result as a viewer pass.

Both 0.3.1 saves also retained real `attachment_reader_missing` Web-verifier outcomes before normal Zotero UI inspection. The owned Layer Normalization reader later showed annotation `6HS9XLR7` on page 4 of 14 with its complete 23,571-character comment. The owned ResNet reader later showed annotation `2WYFHJ28` on page 3 of 12 with its stored comment. These observations establish actual reader display separately. The ResNet source-preparation failure remains failed even though its stored body rendered.

## Observed selected-Web latency

One selected-plugin ResNet turn took 4 minutes 42 seconds before completing. The request eventually produced the expected local read/save progression. This is a single environment observation, not an established cause, service-level guarantee, or reason to repeat unchanged requests.

In the 0.3.1 correction run, the first selected save turn took 4 minutes 41 seconds and the second took 3 minutes 56 seconds. Both completed. These are additional environment observations only; no platform, bridge, model, or native-reader cause is inferred.

## Historical ordinary ChatGPT Web activation inconsistency

The private production plugin is installed, enabled, configured, and connected to Mac Safe Files. An ordinary 0.2.0 save request selected it but reached a subsequently repaired native import failure. Two fresh ordinary 0.2.1 conversations then returned no available Zotero integration without dispatching the workflow, despite the management UI showing the production plugin enabled and Mac Safe Files connected. These are observed activation failures; their cause has not been established. Version 0.2.2 account/source/connection readback succeeded. A further fresh ordinary 0.2.2 conversation after native removal/reinstall likewise reported no available Zotero integration after one natural save request; no bridge request was dispatched. Studying alone had also left the bridge unchanged. The required two complete ordinary-Web save conversations were not met under that workflow. A separate explicit-selection diagnostic using the owned plugin’s Try in chat action succeeded: the visible plugin selection invoked Mac Safe Files and sent only a read-only connection-status request, which confirmed the live 0.2.2 runtime. This establishes that explicit selection and tool binding worked; it does not establish implicit activation. Read-only source/account inspection found matching manifests, skill instructions, the exact app dependency, and implicit-invocation eligibility. Available tools did not expose the failed conversation’s supplied skill/tool set or selection reason, so no package defect or cache cause was established. Normal account Uninstall/Install later restored the same owned plugin, release, private configuration, enabled state, and Mac connection. One bounded fresh ordinary Web check after that materially changed installation state studied the absent exact Batch Normalization `1502.03167v1`. Its natural save request produced a complete proposed comment but no plugin dispatch or bridge request; no import or annotation was attempted. This is another observed activation failure, not an import or content-preservation failure. Preserve it as historical platform evidence. Decision 0004 makes visible explicit selection the 0.3.0 start, so future implicit activation is an optional convenience rather than a completion gate.

## Native Zotero editor whitespace changes

During the owned 0.2.2 manual-conflict test, directly saving a manual marker in Zotero's native comment editor changed interior whitespace in the existing study body. Non-whitespace characters and the marker were preserved; the extension's earlier append had passed exact full-content readback. The subsequent stale extension update returned `conflict` and left the entire manually edited body unchanged. Keep this host-editor behavior separate from extension persistence; do not promise byte-preserving native UI edits or silently restore an older body after a person edits it.

## Historical uncertain operations

Two owned pre-fix acceptance operations remain terminal historical unknowns: one parent-creation attempt failed before native field initialization completed, and one annotation committed a body differing by a final newline. Public native initialization and precommit comment-representability fixes are now installed and separately verified. Those explanations do not rewrite terminal outcomes or authorize replay under a fresh identity. Preserve their journals and any existing native data.

## Resolved external preflight: arXiv metadata

The 2026-10-22 HTTP 429 preflight and the user's implementation deferral remain historical facts. Later actual production Zotero requests obtained concrete-version Atom metadata for 1706.03762v7 and 1607.06450v1, and the latter PDF was imported and locally parsed/fingerprinted. The metadata-access check is therefore no longer deferred. No cause is inferred for the earlier response, and no alternate endpoint or HTML metadata substitute established these passes. Continue respecting rate limits.
