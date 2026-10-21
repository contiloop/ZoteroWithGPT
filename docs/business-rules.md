# Study behavior

A paper is a library item; a PDF is a specific attachment of that item. Search results are candidates, not an implicit choice. Multiple similarly named papers or attachments require a selected identity before a save.

A passage anchor names one PDF revision and a page-local location. Missing text, repeated text without sufficient context, or an unconfirmed region yields candidates or an unresolved result, with no annotation. Changing PDF content invalidates old anchors; a matching page number alone cannot preserve them.

## Recording research

The default destination for an explanation, question, proof, or reference is a native annotation at the relevant passage. There is no target annotation count. Content length never changes the destination to a separate note. A separate item note is created or changed only when requested explicitly.

An update identifies an existing annotation or note and the revision just read. Append preserves existing content and adds the requested material; replace changes only the specifically approved body. A conflicting manual or synchronized edit leaves the current record unchanged. Read the new content and obtain renewed approval before a revised edit.

The saved body limit applies to the complete result, including existing text, separators, and required safety encoding. Exceeding the limit rejects the operation without truncating content or moving it elsewhere. An existing rich note that cannot be preserved safely is rejected for append rather than repaired silently.

Generated explanations distinguish author claims, user questions, assistant interpretations, and unverified hypotheses. A sufficient-condition proof used for intuition must not be presented as a theorem established by the paper. References require actual source evidence rather than invented titles or URLs.

## Identity and outcomes

One operation identifies one immutable request. The same identity and content returns its historical outcome; changing content under that identity is a conflict. A fresh observation requires a fresh operation ID.

A queued operation has not executed. An interrupted queued operation becomes a definitive rejected non-write rather than resuming on startup. An interrupted running operation may have committed; recovery inspects its native identity before deciding. If that cannot establish an outcome, it remains indeterminate and must not be resubmitted as a new operation.

A successful historical operation remains historical after a person deletes its annotation. Replaying it does not recreate the deleted record. Multiple operations have independent outcomes; partial success does not imply rollback of earlier saves.

Storage confirmation means a native record was read back. Viewer confirmation means current content was observed in its actual active reader. Neither a deep link nor a background tab establishes visible display. Viewer failure does not authorize repeating a successful save.

Removing the extension stops processing and retains native study records. Reinstall does not authorize old unexecuted requests. A connection's new session is a fresh processing boundary, not a new identity for historical mutations.
