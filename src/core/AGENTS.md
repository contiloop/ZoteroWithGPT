# Operation coordination

Authorization records, immutable snapshots, state transitions, and serialized execution. No native Zotero, DOM, transport filesystem, or renderer implementation belongs here.

Claim ID and canonical digest before execution. Terminal results are historical and immutable. Queued recovery proves nonexecution; running recovery may not. Never manufacture storage or viewer confirmation. Maintain per-profile mutation serialization and do not mutate a caller's validated request object.

Exercise duplicate IDs, changed payloads, concurrent submissions, queued interruption, running reconciliation, explicit authority, and indeterminate outcomes.
