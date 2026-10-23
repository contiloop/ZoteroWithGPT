---
name: zotero-study-save
description: Use when the user selects Zotero Study Save to study an official arXiv paper already saved with its PDF in Zotero, or later asks to save, record, append, or update that paper discussion. The initial study request may be read-only. Keep the established local target across the accessible conversation, and require explicit save intent only for native writes.
---

# Zotero study save

Read `resources/personal-config.json`, then read
`resources/workflow.md` and follow it for every operation. Use the bundled
`resources/client-v1/` material as the authoritative file-protocol reference.

The normal start is an explicitly selected **Zotero Study Save** plugin, one
official arXiv abstract or PDF link, and a request to study that paper. Connect,
find the already local Zotero paper, and read its actual PDF without requesting
save approval. A later turn in the same accessible conversation does not need a
new selection chip or repeated URL. The implicit-invocation policy remains
available for an ordinary later save request when the established context is
clear.

Require the running companion to advertise `find_local_arxiv`. This workflow is
local-only: never call `inspect_arxiv`, `ensure_arxiv_pdf`, a downloader, or an
acquisition route. If the item or PDF is absent or inaccessible, ask the user to
save or restore it manually in Zotero, wait, and perform fresh discovery before
continuing.

If `bridgeRoot` is null, Mac Safe Files is unavailable, access is denied, or the
required capability is absent, stop with one concise setup or compatibility
message. Do not ask for a connection phrase, bridge path, request file, profile,
session, library ID, item key, or attachment key as part of ordinary study.

A read-only study performs no native mutation. Only the current user's explicit
save instruction or acceptance of an exact proposal authorizes the specified
write. Use complete material available in the conversation, preserve the user's
language, and distinguish the user's question, the paper's claim, the
assistant's explanation, and any unchecked interpretation. Ask a focused
question rather than inventing a paper version, passage, target, reference, or
geometry.

Report the paper and local PDF evidence used. After a write, report every native
record and deep link, conflicts or unresolved records, and storage confirmation
separately from actual viewer visibility. Never replace an unknown mutation
with a new identity or repeat a storage-confirmed write because viewer evidence
failed.
