# Native integration knowledge

## Reader objects can outlive their windows

After an extension update, a formatted comment remained visibly correct while verification reported an inspection error. Zotero's error console showed “can't access dead object”; a normal quit/reopen restored strict verification on the same package and comment. An independent probe reproduced the failure by removing an unrelated reader and making its old iframe getter throw. The old synchronization order read that getter before checking membership. Synchronization now checks removed-reader membership first and isolates inaccessible entries, with best-effort cleanup. A retained inaccessible reader is retried and may report again on later scans so a revived reader can reattach; repeated diagnostic messages alone are not a new write failure. Verify a healthy target alongside an unrelated destroyed reader, not only a single-reader fixture.

## Native source and preview are different surfaces

Formatted mode hides Zotero's source editor. A source-editor check can therefore fail while the rendered comment is visible. Conversely, an open background tab is insufficient viewer evidence. Inspect exact current markup and owner visibility; then switch between native edit and formatted preview and verify again. A failed viewer response is not grounds to repeat the saved write.

## Plugin globals are not browser globals

The Zotero plugin sandbox lacks some Window APIs. PDF worker calls also reject caller-realm objects with DataCloneError. Supply the validated JSON snapshot primitive at bootstrap and clone worker arguments into the owning realm. Verify in Zotero after changes; Node-only test globals conceal these failures.

## Main documents may be XUL

Creating HTML parsing containers against the main chrome document can produce the wrong namespace or MIME assumptions. Child-note safety processing uses a trusted live main window and a detached inert HTML document. New unsafe source remains readable as escaped text. Existing native note HTML is checked without rewriting it; otherwise a harmless append can destroy a user's table or reference.

## Sanitizers and math need separate semantic checks

A broad MathML tag allowlist can still erase cancellation or alignment if semantic attributes are removed. Restrict attributes by element and namespace while preserving the meaning of validated math. Inspect actual cancellation/aligned output, numbered steps, paragraph spacing, and a clicked safe reference. Preserve raw native notation for removal or renderer failure.

## Request results are historical

Reusing an observation ID returns old data even after the target changed. Use fresh IDs for new reads and verification. A missing result is not evidence of nonexecution: inspect the active session and recover a potentially running mutation using its original identity. Only an explicit queued-interruption non-write allows a newly approved mutation under a fresh identity.

## Extension metadata has host-specific requirements

Zotero 10.0.6 rejected an otherwise built XPI without a truthy update URL. The package uses a reserved .invalid URL to meet that host requirement without inventing an updater. Check installation and manual-update behavior in the actual Plugins Manager; archive inspection alone does not prove installability.

## Planned native keys require primary data initialization

Assigning a planned key to a newly constructed Zotero item marks that data object as identified. Field and relation setters can then require loaded `primaryData`, even though the item has never been saved. The supported host sequence is to construct the item, set its library, assign the planned key, await the public `loadPrimaryData()` method, populate fields and relations, and save through the native transaction. Both arXiv parent and PDF attachment creation follow this sequence. Because the load is an asynchronous boundary, recheck authority, library ownership, current file evidence, and planned-key availability after it and before any field mutation.

An actual pre-fix parent creation reached its first field setter without that load and raised Zotero's unloaded-primary-data exception before save; the SQLite transaction rolled back. Its durable operation history had already entered the prepared/running boundary and remains a terminal historical unknown. Source evidence about the rollback does not authorize rewriting that result, inferring absence from a search, or retrying the mutation under another identity.

## Partial import failure keeps the confirmed parent

The import order acquires and stages the PDF before committing the parent, then creates and installs the attachment. A reviewed fixed-command host probe injected a fault at the attachment-create boundary after the parent commit. The actual response was terminal `failed` / `storage_error`, nonretryable, with `completion: item_only` and confirmed storage. Native UI readback found the one synthetic parent with zero attachments; the planned attachment had no native record or installed file, and the in-memory staging was discarded.

This is evidence for the post-parent attachment boundary, not for a real network download failure. Recovery may retain a confirmed parent, but it must not infer a missing attachment from the response alone, invent a new operation identity, or overwrite an existing parent. Reconcile the planned keys and durable stage before any later authorized work.

## Authority must survive awaited acquisition

Authority checks before an asynchronous source read are insufficient because access can be disabled while that read is pending. A second fixed-command host probe used a real timer await in its isolated in-memory acquisition and closed only its diagnostic gate before continuation. The actual result was terminal `rejected` / `permission_denied`, nonretryable, with no native checkpoint, marker, candidate, or plan/create/install call. Fresh native search found no synthetic item.

The controlled result validates the post-await gate in the native workflow. It does not claim that production settings were toggled. Each awaited boundary must recheck the same authority, library, file, and operation evidence that governed the initial call, and a shutdown or lifecycle transition must prevent a confirmed dialog from starting a later diagnostic run.

## Native annotation comments have a canonical form

Zotero 10.0.6's public `annotationComment` setter applies `trim().normalize()`. A comment with leading or trailing whitespace, including an incidental terminal newline, or a decomposed Unicode sequence can therefore commit successfully but differ from the approved request during exact readback. One actual run exposed this boundary: the native annotation was visible with the complete substantive study content, while the operation correctly remained indeterminate because the stored comment omitted the request's final newline.

Check `comment.trim().normalize() === comment` before invoking either native annotation create or update. Reject a mismatch before changing the item or durable marker. Clients prepare the exact NFC, boundary-clean candidate before authorization and operation-ID assignment; they do not silently trim meaningful content after approval. Interior blank lines, indentation, mathematics, and references remain byte-for-byte content for readback. A historical indeterminate write remains historical even when the representability rule explains its mismatch.

## Native editor saves can normalize study text

During the owned 0.2.2 manual-conflict check, Zotero's native comment editor preserved all non-whitespace characters and the new marker but changed interior whitespace in the existing long study body. This was a direct native UI save after the extension's exact 7,388-character append had already passed readback. Treat the resulting native body and revision as current user data. Do not restore an older extension snapshot or attribute the editor's transformation to a later protocol write.

The subsequent stale `update_annotation` request returned `conflict`, and a fresh listing proved the complete editor-produced body and revision unchanged. This validates revision fencing while also showing that byte-exact extension persistence does not imply byte-exact edits through Zotero's own editor.

## Plugin removal and installation have restart boundaries

Normal removal and installation are separate host lifecycle transitions. An observed reinstall attempted before the removal-completing restart appeared enabled in the current Plugins Manager but was absent after restart. A request published to that unsatisfied session remained unprocessed. The reliable acceptance sequence was remove, restart, install, restart, then verify the profile package and establish a fresh descriptor/status/descriptor connection.

Do not copy an unprocessed request into the new session or assign it another operation ID. Preserve its original identity and outcome uncertainty. Journal-backed replay after the complete reinstall should return the historical result; fresh native reads, rather than replay alone, establish the current parent, attachment, and annotation state.

ChatGPT account lifecycle has a separate distinction: **Uninstall** removes the plugin from active use while preserving the owned backend, whereas **Delete plugin** removes the owned plugin itself. The accepted private-plugin lifecycle used only Uninstall followed by Install on the same backend. Reinstallation restored the checked skill, connected app dependency, current release, and private root configuration without creating another release. Treat an update, a checked skill toggle, and a true Uninstall/Install cycle as different observations.
