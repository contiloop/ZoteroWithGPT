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
  whole-conversation byte copying is not the product default. In the bounded
  third dedicated trial, source-to-body comparison confirmed the complete
  submitted question; its apparent early ending in Zotero accessibility output
  was display truncation rather than stored-content loss.
- A dedicated 0.5 route completed three actual Web study/save pairs, exact tool
  discovery, native-reader checks, and ordinary server, extension, and account
  plugin reinstall cycles. A separate owned-fixture create remains unresolved:
  ChatGPT showed only a model-authored blocked summary, while raw tool arguments
  and the raw error were unavailable, the tunnel log was payload-silent, and
  the inspected bridge session retained no request under the operation ID. The
  absence of a retained request does not prove the service never received or
  executed the call. No new annotation was found, but the operation must not be
  reissued or reidentified. Original-ID result recovery remains unresolved; the
  fixture-dependent append, manual-edit conflict, deletion, and historical
  replay tests remain unaccepted.
- The three-pair route comparison was mixed. Existing Mac versus dedicated 0.5
  median UI times were 122 s versus 94 s for study and 196 s versus 226 s for
  save; observed wall upper bounds were 177 s versus 179 s and 225 s versus
  253 s. Polling, body size, model work, and dedicated write approvals differed,
  so these runs do not establish a speedup. The selected plugin was restored to
  the shared Mac route as version 0.5.1; the dedicated connection and healthy
  runtime remain separately available.
- Stable public HTTPS/authenticated profile routing, end-user transport
  lifecycle, ChatGPT Work access, a distribution license, and a public release
  channel are not established.
