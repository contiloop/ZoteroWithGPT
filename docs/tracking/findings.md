# Open findings

- An installed 0.3.0 read-only `list_annotations` stalled during reader
  acquisition and blocked the serialized scanner. A later cold-reader probe
  completed, so the cause remains unknown. Finite reader acquisition and
  read-specific recovery wording are possible follow-ups; do not retry an
  uncertain write to work around a reader failure.
- Zotero's own editor can normalize interior whitespace. After a manual edit,
  its current body/revision is authoritative; do not restore an older snapshot.
- Model preparation can omit requested details even when native readback is
  exact. Check the requested content and mathematical meaning before sending;
  whole-conversation byte copying is not the product default.
- Existing Mac Safe Files is required. Public transport installation, ChatGPT
  Work access, a distribution license, and a public release channel are not
  established.
- The 0.4.0 Web check reported 2m 18s for a short local-PDF explanation and
  4m 21s for one highlight/comment save, with per-turn file-write approval
  prompts. The flow works, but this run does not establish acceptable latency;
  browser/model orchestration and approval time were not measured separately.
