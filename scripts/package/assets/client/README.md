# Research Companion local client

Package version: `{{PACKAGE_VERSION}}`

Copy this kit into `<BRIDGE_ROOT>/client-v1` and select `<BRIDGE_ROOT>` in
Zotero Research Companion Settings. The entry is
`<BRIDGE_ROOT>/client-v1/README.md`. Enable the bridge and keep Zotero running.
The kit is reference material, not an executable service.

This kit is the generic local-file fallback. Configure it only for a client that
deliberately implements the file contract. Zotero Study Save uses the separate
dedicated MCP adapter and does not bundle this directory. `protocol/v1.md` and
the adjacent schemas own request/result shapes.

Other local-file clients use the same contract. Read descriptor/status/descriptor
before every publication, require a stable enabled session, and use complete
create-only requests. Fresh reads need fresh IDs; uncertain mutations retain
their original identity. Only the user's specified save authorizes a write.

The active pipeline is local discovery, PDF reading, passage resolution, and
native annotation creation/update. Missing PDFs require manual Zotero action.
`inspect_arxiv` and `ensure_arxiv_pdf` survive in historical schemas only and
return unsupported for new requests. Do not use acquisition as a fallback.

The requested scope determines whether to save a passage, an explanation, or
a broader discussion; routine saves do not collect the entire conversation.
Preserve mathematical meaning and supported references. Long content stays in
the PDF reader; separate notes require an explicit request. Reader failure does
not justify repeating a storage-confirmed save.

Removal leaves native annotations and operation history intact. See
`docs/install.md`, `docs/uninstall.md`, and `docs/troubleshooting.md`.
