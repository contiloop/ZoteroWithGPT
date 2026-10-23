# Historical arXiv import

Superseded by [local study](0004-selected-local-arxiv-study.md).

The earlier workflow imported missing arXiv papers during an authorized save.
That coupled study recording to remote metadata availability and acquisition
mutations. The researcher now saves papers manually, so acquisition code and
new import execution are removed.

Protocol-v1 shapes, native provenance readers, and stage reconciliation remain
because installed journals contain import identities and partial outcomes.
Deleting those shapes would break recovery/replay; retaining them must never
resume a download or create a missing historical object.
