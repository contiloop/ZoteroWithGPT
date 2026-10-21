# Durable operation history

Atomic profile-local journal, immutable results, identity hashing, and keyed serialization. No study-content authority or automatic native recreation.

Retain historical successful identities across reinstall and manual deletion. Resolve an interrupted queued claim to a definitive non-write. Native recovery of running claims inspects markers and current state; it must not rerun create. The journal may contain private response content, so error output and fixtures must be reviewed.

Cover atomic persistence failure, duplicate claims, restarted queued/running states, marker reconciliation, deleted targets, and concurrent startup/live submissions.
