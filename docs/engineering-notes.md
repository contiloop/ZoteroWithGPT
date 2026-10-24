# Zotero host knowledge

## Dead readers

Reader wrappers can survive destroyed windows and throw “can't access dead
object” when an iframe getter is read. Check membership before touching it and
isolate inaccessible entries; otherwise one unrelated dead reader aborts all
healthy synchronization. A normal restart once restored viewer checks without
changing the saved content.

## Source, preview, and active owner

Formatted mode hides Zotero's source editor, so editor visibility is not preview
visibility. A background tab is also insufficient. Inspect fresh current markup
and the active owning reader; a failed display check never repeats a save.

## Sandbox and owner realms

Zotero's plugin sandbox lacks some Window globals. PDF worker arguments need
cloning into the owning realm or throw DataCloneError. Main chrome documents
may be XUL: note sanitization uses a live main window and detached inert HTML
document, not an assumed HTML main document.

## Native comment normalization

Zotero 10.0.6's `annotationComment` setter applies `trim().normalize()`. Prepare
NFC text without boundary whitespace before approval/identity assignment; reject
an already approved unrepresentable body before setters. A historical trailing
newline mismatch remains an unknown outcome, not permission to retry.

Zotero's native editor can also change interior whitespace. Its newly saved
body/revision is authoritative; do not restore an earlier extension snapshot.

## Legacy attachment paths

Zotero 10.0.6 file-path getters can repair raw macOS `AAAA...` attachment paths
with a database update. Offline discovery checks the raw descriptor first to
avoid this hidden mutation. A candidate without current byte evidence stays
unverified and requires manual restoration plus fresh discovery before reading.
Parent or sibling provenance cannot prove that attachment's PDF version.

## Installation boundaries

Zotero requires a truthy update URL even for manual distribution. The reserved
`.invalid` URL meets that requirement without providing an updater.

Removal needs a restart before reinstall, followed by another restart. Installing
before removal completed once appeared enabled but vanished after restart.
ChatGPT **Uninstall** preserves the owned backend; **Delete plugin** destroys it.
Neither a plugin update nor a skill toggle proves an uninstall/reinstall cycle.

The dedicated MCP runtime uses `tunnel-client runtimes connect`, not a detached
shell process. Its existing-tunnel path performs read-only tunnel lookup and the
managed health listener binds an ephemeral loopback port. Status is acceptable
only when `process_running`, `healthy`, and `ready` are all true. Runtime removal
owns one fixed alias/profile and its fenced local root; the bridge sessions,
native journal, credential file, and remote tunnel are separate persistence
domains.

## Stalled reader acquisition

A read-only `list_annotations` once held the scanner while acquiring a reader.
A later cold-reader probe completed, leaving the cause unresolved. Reconnect
persisted disabled state before waiting for the stuck handler, explaining that
state after restart. Preserve operation identity, re-enable explicitly, and
check a fresh session. Recovery's historical-write warning was misleading for
this read; do not claim forced-quit recovery from ordinary reinstall evidence.

## Preparation versus persistence

Exact native readback proves the submitted body was stored, not that the model
included the requested details. A historical run omitted empirical comparison
outcomes before submission. Check requested scope and math meaning; compare
verbatim wording only when copying was requested.
