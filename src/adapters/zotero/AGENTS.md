# Guarded native access

Zotero discovery, native records, note policy, revisions, and operation-marker reconciliation. No SQLite writes, PDF rewriting, or transport parsing.

Check current access immediately before synchronous native setters and marker mutation. Compare actual target revisions and revalidate anchors. Read back committed content before success. Apply aggregate encoded body limits. Note append preserves safe existing HTML byte-for-byte; validate new fragments in an inert HTML document, and reject unsupported existing content before mutation.

Cover stale/manual edits, post-await disable, cached native objects, aggregate size and escaping, safe tables/links/math, ambiguous HTML, bounded DOM work, readback mismatch, and commit-boundary recovery. Test actual Zotero separately from fixture facades.
