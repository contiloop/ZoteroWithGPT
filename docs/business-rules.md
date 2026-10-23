# Study behavior

A paper is a library item; a PDF is a specific attachment of that item. Search results are candidates, not an implicit choice. Multiple similarly named papers or attachments require a selected identity before a save.

A passage anchor names one PDF revision and a page-local location. Missing text, repeated text without sufficient context, or an unconfirmed region yields candidates or an unresolved result, with no annotation. Changing PDF content invalidates old anchors; a matching page number alone cannot preserve them.

## Recording research

The default destination for an explanation, question, proof, or reference is a native annotation at the relevant passage. There is no target annotation count. Content length never changes the destination to a separate note. A separate item note is created or changed only when requested explicitly.

Saving identified existing discussion blocks preserves their complete canonical source by default, including ordinary requests to organize the proof and question just discussed. Organization may add clearly separated labels and source associations around unchanged blocks; it does not silently condense them. A user-explicit rewrite or condensation defines a different requested deliverable. Native-compatible mathematical delimiter or escape preparation changes presentation only, preserving prose, facts, conditions, numerical comparison outcomes, proof steps, substantive whitespace, and links. Compare each requested source block with the prepared body before assigning the write identity; unavailable, unrepresentable, or over-limit content stops before mutation rather than becoming a summary.

An update identifies an existing annotation or note and the revision just read. Append preserves existing content and adds the requested material; replace changes only the specifically approved body. A conflicting manual or synchronized edit leaves the current record unchanged. Read the new content and obtain renewed approval before a revised edit.

The saved body limit applies to the complete result, including existing text, separators, and required safety encoding. Exceeding the limit rejects the operation without truncating content or moving it elsewhere. An existing rich note that cannot be preserved safely is rejected for append rather than repaired silently.

An annotation comment must be exactly representable by Zotero's native setter: Unicode NFC with no leading or trailing whitespace. Prepare and approve that exact body before publication. Incidental file-boundary whitespace may be excluded during preparation, but substantive interior whitespace remains unchanged. If canonical preparation would alter an already approved body, obtain renewed approval and use a fresh operation identity; the extension rejects the unrepresentable body before native mutation instead of silently normalizing it.

Generated explanations distinguish author claims, user questions, assistant interpretations, and unverified hypotheses. A sufficient-condition proof used for intuition must not be presented as a theorem established by the paper. References require actual source evidence rather than invented titles or URLs.

## Identity and outcomes

The selected local-study workflow starts only after the researcher manually saves the paper and PDF in Zotero. One official arXiv URL authorizes offline discovery and local PDF reading, not a download, import, repair, or native write. Parent metadata can identify a candidate but cannot prove PDF bytes or a PDF version. An unknown version stays unknown, and an unversioned URL is not a request for the latest version.

Discovery searches all eligible libraries. Multiple parents or PDFs, conflicting evidence, a truncated result, an unreadable attachment, or an explicit-version mismatch requires a focused choice or manual Zotero action rather than a first/latest match. A selected attachment without a current fingerprint has inaccessible or unverified bytes; do not call `read_pdf` or another read to repair it. After the researcher restores its file or path in Zotero, use fresh discovery and continue only when it returns a current fingerprint. Preserve the selected item's library and collection placement and leave unrelated records unchanged.

The target is established only by current discovery evidence plus an actual `read_pdf` result. Keep that target in accessible conversation context so a later save need not repeat the URL, page, passage, or native keys when they remain inferable. A failed explicit paper switch suspends the prior implicit destination. Comparing or citing another paper does not switch the destination, and referenced works remain links unless the researcher separately requests their own supported action.

The retained `inspect_arxiv` and `ensure_arxiv_pdf` operations remain valid for legacy clients and immutable historical results. They are outside the selected local-study workflow. Their inspection tokens, exact-version selection, partial import outcomes, and commit-time revalidation rules continue to apply when an older client invokes them.

One operation identifies one immutable request. The same identity and content returns its historical outcome; changing content under that identity is a conflict. A fresh observation requires a fresh operation ID.

A queued operation has not executed. An interrupted queued operation becomes a definitive rejected non-write rather than resuming on startup. An interrupted running operation may have committed; recovery inspects its native identity before deciding. If that cannot establish an outcome, it remains indeterminate and must not be resubmitted as a new operation.

A successful historical operation remains historical after a person deletes its annotation. Replaying it does not recreate the deleted record. Multiple operations have independent outcomes; partial success does not imply rollback of earlier saves.

A confirmed bibliographic parent retained after PDF failure is an `item_only` partial result, not a ready PDF or completed study save. A possibly committed import with insufficient readback remains unknown and stops subsequent annotation writes for that attempt. Retain useful confirmed imports when later passage resolution or annotation fails. Terminal indeterminate results remain immutable historical unknowns across reconnect and reinstall; startup reconciliation applies to interrupted running operations and does not turn terminal history into a fresh write.

Storage confirmation means a native record was read back. Viewer confirmation means current content was observed in its actual active reader. Neither a deep link nor a background tab establishes visible display. Viewer failure does not authorize repeating a successful save.

Removing the extension stops processing and retains native study records. Reinstall does not authorize old unexecuted requests. A connection's new session is a fresh processing boundary, not a new identity for historical mutations.
