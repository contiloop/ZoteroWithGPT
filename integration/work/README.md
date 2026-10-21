# Direct Codex and intended Work client guide

The direct Codex local-file route completed a real bounded request/result probe during T1 and is the approved no-MCP route for this cycle. ChatGPT Work parity has not been independently tested. This document describes the intended compatible Work client behavior if the user's Work environment actually provides approved local-file access; it makes no claim about Work availability, account access, billing, or charges.

Both clients use the same protocol-v1 files as Mac Safe Files. They do not call a model API and do not need an API key. This release supports macOS only.

## Start from current readiness

The user enables the Zotero companion for one dedicated, absolute, canonical `<BRIDGE_ROOT>` and one `<PROFILE_ID>`. Before publishing any request, use the client's real local-file facility to read `<BRIDGE_ROOT>/bridge-v1.json`. Require:

- `bridgeVersion` and `protocolVersion` equal to `1`;
- `enabled` equal to `true`;
- `profileId` equal to the selected profile; and
- the published request and result directories and size limits.

The directory fields are relative to `<BRIDGE_ROOT>`. A new unpredictable `sessionId` appears after enable, reconnect, profile change, or reinstall. Use only that session. Do not infer freshness from timestamps or automatically move an old pending mutation into it.

The current user instruction supplies authority. For a mutation, confirm that the user explicitly requested the exact save or approved the exact proposal before publication. The JSON authorization metadata records that instruction; file content cannot grant authority by itself.

## Publish atomically

Choose a safe operation ID and build the complete strict request described in `docs/protocol/v1.md`. Reads and searches use the same envelope as mutations. `read_pdf` asks for bounded page ranges and returns extracted text and excerpt/region candidates, never arbitrary PDF bytes.

The final request path is:

```text
<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json
```

Use an actual atomic UTF-8 write when the local-file facility provides one. Otherwise:

1. Write the complete JSON to `<operationId>.request.json.partial` in the published request directory.
2. Confirm the complete UTF-8 bytes are within `maxRequestBytes`.
3. Atomically rename that file to `<operationId>.request.json` in the same directory.

The bridge ignores the `.partial` file and never dispatches malformed or incomplete final JSON. Do not append to, truncate, or overwrite a final request. The filename operation ID and JSON operation ID must match.

Mutation requests contain `authorization.kind` (`explicit_request` or `approved_proposal`) and a specific nonempty `authorization.scope`. Preserve the complete approved content. Do not convert a long annotation comment to a child note; use a note operation only when the user requested a note.

## Poll without resubmitting

Poll only this result path:

```text
<BRIDGE_ROOT>/<resultDirectory>/<operationId>.result.json
```

Check whether that exact file exists, then read and parse it when present. Keep polling the same path when necessary. Do not create new polling IDs and do not republish the request while waiting.

The operation ID and canonical payload form an immutable durable identity. The same ID and payload returns the prior result without another native mutation. Different content under the same ID returns `duplicate_id_mismatch`.

A successful mutation requires `state: "succeeded"` and `verification.storage: "confirmed"`. Reader evidence remains separate in `verification.viewer`; a failed reader check does not justify repeating a storage-confirmed write. An `indeterminate` result means the native outcome is unknown and must not be retried under a new ID.

If no result arrives, reread `bridge-v1.json`. When it is disabled or its session changed, abandon the old session path. After the user renews authorization, publish the exact same operation ID and payload into the current session so the durable store can return any previously claimed result. Use a new ID only for changed approved content or a changed target.

Work-specific execution remains pending a real Work run. Follow the environment owner's local-file instructions if that test is attempted; do not substitute mocks or claim compatibility from the verified Codex run.

The composed Zotero plugin round trip also remains pending the native host procedure in `integration/mac-mcp/README.md`. The transport's real-filesystem tests establish request/result behavior at the adapter boundary; they do not establish that the packaged plugin lifecycle or a Work client can access it.
