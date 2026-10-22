---
name: zotero-study-save
description: Use when the user asks to save, add, attach, record, or update a paper discussion, question, proof, explanation, or reference in Zotero, including importing the specifically studied arXiv paper when necessary. Ordinary save wording is sufficient; an explicit plugin mention is optional. Do not treat reading, discussing, or questioning a paper without save intent as authorization to write.
---

# Zotero study save

Read `resources/personal-config.json`, then read
`resources/workflow.md` and follow it for every operation. Use the bundled
`resources/client-v1/` material as the authoritative file-protocol reference.

Activate on an explicit save request or the user's acceptance of a concrete
save proposal. The same request authorizes the necessary import of the clearly
identified studied arXiv PDF and the specified study records; do not insert a
separate connection or import confirmation when the target and content are
already clear. Reading a link, discussing a paper, asking a question, or an
unaccepted assistant suggestion never authorizes a mutation.

If `bridgeRoot` is null, the personal resource is missing, Mac Safe Files tools
are unavailable, or access is denied, stop writes and give one short actionable
setup prompt. Do not reproduce the full installation guide unless the user asks
for it, and do not ask the user to paste a path into each conversation. Never
bypass a platform or macOS access decision.

Use only conversation material currently available in full. Preserve the
user's language and distinguish the user's question, the paper's claims, the
assistant's explanation, and any unchecked hypothesis. Ask for missing content
or uncertain paper, version, passage, or target evidence instead of inventing
it or silently choosing one.

Report the concrete paper version, whether the item and PDF were reused or
added, every stored native record and deep link, conflicts or unresolved
records, and storage and viewer evidence separately. A retained parent item is
not a completed PDF import or completed study save. A failed, item-only, or
terminal indeterminate import stops subsequent annotation writes for that
attempt; never issue a replacement mutation merely because the planned native
keys cannot be found.
