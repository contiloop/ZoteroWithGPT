# Architecture

ChatGPT Web supplies analysis and the user's save intent. A dedicated private
Secure MCP tunnel supervises one stdio MCP process. That process translates 14
fixed tools to protocol-v1 files in one configured bridge root. The Zotero
extension remains the only native executor: it reads the chosen PDF and commits
native annotations without exposing a network listener.

The core depends on ports; plugin composition binds Zotero, Gecko filesystem,
geometry, persistence, and rendering adapters. Transport replacement must not
change save authority, target identity, or retry semantics.

The MCP bridge port is replaceable and owns no native writer, operation journal,
generic filesystem tool, or paper acquisition path. It publishes create-only
requests with immutable operation IDs and returns the exact native result. MCP
text is a concise companion to structured content; it never replaces full-body
native readback. The generic local-file client kit remains a separate fallback
artifact and is not bundled into the selected ChatGPT plugin.

## Pipeline

1. Discover the manually saved paper by arXiv identity and read its local PDF.
2. Keep the chosen attachment in accessible conversation context.
3. On a save request, prepare only the requested content and resolve its passage.
4. Recheck authority, PDF fingerprint, and revision; commit native Zotero data.
5. Read back the saved body and return its deep link. Reader visibility is
   independent evidence and never a reason to repeat the write.

The journal survives reinstall to prevent duplicate execution. Old arXiv import
schemas and read-only reconciliation remain solely to interpret pre-cut history;
new acquisition operations are unsupported. PDF bytes and SQLite are never
modified by annotation saves. Native comments are canonical; sanitized formatted
previews are disposable and preserve editable Markdown/LaTeX source.

## Runtime ownership

The server package installs under one owned stable root with versioned releases,
a stable lifecycle launcher, and private tunnel metadata. The fixed alias and
profile are `zotero-study-save-mcp`. `tunnel-client runtimes connect` supervises
the process and uses an existing tunnel ID read-only; its loopback health port
is ephemeral. Removal stops and removes only that alias and owned local tree.
Bridge sessions and the Zotero `operations-v1.json` journal live outside the
runtime root and survive ordinary reinstall.

Rollback selects the prior installed route and leaves it stopped. It never
replays a request. Account-plugin routing rollback is a separate operation: the
account service rejects semantic-version downgrades, so restoring an older route
requires the preserved private content under a newer guarded release version.
