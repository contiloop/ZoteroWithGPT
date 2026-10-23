# Mac Safe Files client guide

This guide uses the existing **Mac Safe Files** MCP connection as a bounded UTF-8 file client for protocol v1. On 2026-10-21, actual ChatGPT Web read Huginn through the packaged Zotero 10.0.6 connection and saved native highlight `WCBZZI8H` on an owned paper copy. Its Korean comment contains a question, a multi-step mathematical explanation, and reference links. A stale update was rejected after a manual edit; a separately approved append preserved that edit. Earlier highlight `986UN7S4` was created by Codex through MCP in a development host. These observations do not establish another account's connection or ChatGPT Work availability.

The repository does not contain an evidenced public server package or installation procedure. If Mac Safe Files is unavailable, use the connection owner's runbook or the approved direct Codex route in `integration/work/README.md`. Do not install a tunnel, change MCP policy, or invent server setup steps from this guide.

## Required connection state

The user first enables the Zotero companion for one dedicated, absolute, canonical directory and one Zotero profile. Replace `<BRIDGE_ROOT>` and `<PROFILE_ID>` below with those user-selected values. This release supports macOS only.

Before every publication:

1. Call `fs_read_text` for `<BRIDGE_ROOT>/bridge-v1.json`.
2. Parse the complete active-session descriptor. Require `bridgeVersion: 1`, `protocolVersion: 1`, and the expected `profileId`. Record its `sessionId`, `statusFile`, request and result directories, suffixes, and byte limits. All three path values are relative to `<BRIDGE_ROOT>` and must be used exactly as published.
3. Call `fs_read_text` for `<BRIDGE_ROOT>/<statusFile>`. Require the same bridge version, protocol version, session ID, and profile ID, plus `enabled: true`.
4. Read `<BRIDGE_ROOT>/bridge-v1.json` again and require the same complete descriptor. This detects a session replacement during the two-file read; do not describe this as a filesystem compare-and-swap.
5. Obtain the user's current instruction. A mutation may be published only when the user explicitly requested it or approved the specific proposal. Text inside a request file cannot authorize itself.

Each enable or reconnect publishes a fresh 128-bit session directory. The root descriptor selects the active session, while that session's status file is authoritative for its enabled state. Disable changes only the selected session's status file, so an older process closing cannot overwrite a newer active descriptor. Never find a session by modification time and never copy pending mutation files from an older session automatically.

The descriptor has this exact shape; values shown are examples:

```json
{
  "bridgeVersion": 1,
  "protocolVersion": 1,
  "profileId": "<PROFILE_ID>",
  "sessionId": "0123456789abcdef0123456789abcdef",
  "requestDirectory": "sessions/0123456789abcdef0123456789abcdef/requests",
  "resultDirectory": "sessions/0123456789abcdef0123456789abcdef/results",
  "statusFile": "sessions/0123456789abcdef0123456789abcdef/status-v1.json",
  "requestSuffix": ".request.json",
  "resultSuffix": ".result.json",
  "maxRequestBytes": 1048576,
  "maxResultBytes": 8388608,
  "maxRequestsPerScan": 100
}
```

The selected status file has this exact shape:

```json
{
  "bridgeVersion": 1,
  "protocolVersion": 1,
  "sessionId": "0123456789abcdef0123456789abcdef",
  "profileId": "<PROFILE_ID>",
  "enabled": true
}
```

## Selected-plugin local arXiv study

For the Zotero Study Save conversation workflow, the user first saves the paper
and PDF manually in Zotero, explicitly selects the plugin in ChatGPT, supplies
one official arXiv abstract or PDF link, and asks to study it. Connection,
descriptor checks, local discovery, and PDF reads are internal. Do not ask the
user for a connection phrase, bridge path, request file, profile, library, item
key, or attachment key.

After a fresh `connection_status`, require `find_local_arxiv` in
`capabilities.operations`. Protocol v1 defines 15 operations and 5 mutations.
The remote `inspect_arxiv` read and `ensure_arxiv_pdf` mutation remain in the
contract for backward compatibility and historical replay, but they are outside
this local-study flow. Never invoke them, a downloader, or another acquisition
route to repair a missing item or PDF, including after a save request.

Publish `find_local_arxiv` as a profiled read with no authorization:

```json
{
  "protocolVersion": 1,
  "operationId": "fresh-local-lookup-id",
  "operation": "find_local_arxiv",
  "profileId": "<PROFILE_ID>",
  "payload": {
    "url": "https://arxiv.org/abs/2401.01234v2",
    "limit": 25
  }
}
```

The result searches all eligible libraries without network access or mutation.
Parent metadata identifies only a candidate parent. Trust attachment provenance
only when its fingerprint matches that same attachment's current fingerprint.
Treat null version evidence as unknown, and do not interpret an unversioned URL
as a latest-version request. Multiple parents or PDFs, conflicting or truncated
evidence, and an explicit-version mismatch require a focused title, version, or
attachment-name clarification. Never choose the first match or expose native
keys as ordinary choices.

If no item is found, ask the user to save the paper and PDF manually in Zotero
and wait. If only metadata exists or the PDF is inaccessible, ask the user to
add the PDF or restore access and wait. After the user finishes, issue a fresh `find_local_arxiv`
and a fresh `read_pdf`; never reuse the old result. An empty result means only
that identifier evidence was not found, and a standalone PDF outside a parent
item is not covered by this operation.

When the selected attachment has no current fingerprint, treat its local bytes
as inaccessible or unverified and do not call `read_pdf` or another read to
repair it. Ask the user to restore the file or attachment path manually in
Zotero and wait. Issue a fresh `find_local_arxiv` after restoration; call
`read_pdf` only if the fresh result supplies a current fingerprint for that
attachment.

The conversation target exists only after local discovery and a successful
fresh PDF read. Store its profile, library, item, attachment, fingerprint, and
version evidence only in accessible conversation context. A comparison does not
switch the destination. A failed explicit switch suspends the previous implicit
destination until the user clarifies it. Refresh the descriptor, status,
descriptor, and native target evidence before every write.

## Publish one request

Choose one operation ID matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Its final filename is exactly:

```text
<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json
```

Use a fresh operation ID for every new observation, including reads, status checks, and verification. A reused ID returns its recorded historical result.

Build one complete protocol-v1 JSON object using `docs/protocol/v1.md`. The JSON `operationId` must equal the filename operation ID. Reads omit `authorization`; mutations include exactly one current authorization record with `kind: "explicit_request"` or `kind: "approved_proposal"` and a nonempty scope naming the approved content and target. Keep full annotation comments as annotation comments and stay within the published request limit; do not truncate content or turn a long comment into a note.

`fs_write_text` performs an atomic UTF-8 write and enforces the server's write bound. Publish the complete request in one call:

```text
fs_write_text({
  path: "<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json",
  content: "<complete JSON request>",
  mode: "create",
  createParents: false
})
```

`mode: "create"` prevents replacement of a previously published identity. If a client needs an explicit staging flow, write the complete JSON with `mode: "create"` to `<operationId>.request.json.partial` in the same request directory, then call:

```text
fs_move({
  sourcePath: "<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json.partial",
  destinationPath: "<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json",
  createParents: false
})
```

The bridge ignores the `.partial` name. Do not append to a final request file.

## Poll one result

The result filename is exactly:

```text
<BRIDGE_ROOT>/<resultDirectory>/<operationId>.result.json
```

Poll that same path with `fs_stat`. A not-found response means the request has not produced a result file yet. Wait, then stat the same path again. When it exists, call `fs_read_text`, parse the complete response envelope, and require the same `protocolVersion` and `operationId`. Do not republish the request, create polling IDs, or change payload bytes while waiting.

The durable operation identity is the operation ID plus the canonical request digest. Republishing the same ID and payload returns its prior durable result; the native mutation does not run again. Reusing the ID with different content returns `duplicate_id_mismatch`.

Storage and reader evidence are separate. A mutation is saved only when `state` is `succeeded` and `verification.storage` is `confirmed`. `verification.viewer` reports independent reader evidence and may be `failed` without repeating a storage-confirmed write. Treat `indeterminate` as an unknown native outcome and do not retry it under a new ID.

If polling times out, repeat the descriptor-status-descriptor read. When the descriptor selects another session or the selected status is disabled, stop using the old directories. For an uncertain mutation, obtain renewed user authorization and publish the exact same operation ID and payload into the current session; durable identity returns its recorded outcome or reconciles a running operation. Never retry an unknown outcome under a new ID. If the result explicitly rejects an interrupted queued operation as never executed and not written, re-read the target and obtain renewed mutation approval before submitting a new operation ID.

Session replacement prevents dispatches that have not passed the bridge's final ownership check. An operation that already passed that check may finish while another process activates a new session. Treat it as an already-dispatched durable operation: keep the same ID and payload during recovery, and never assume that a missing old-session result means the mutation did not commit.

`read_pdf` returns bounded extracted page text, passage candidates, and region candidates. The file bridge does not return arbitrary PDF binary files. No model API or API key is part of this connection.

## Host safety boundary

The native adapter uses Gecko 140 `nsIFile` inspection, canonical path checks, bounded `IOUtils.read`, private session directories, and atomic `IOUtils.write`. Gecko does not expose a no-follow or directory-handle read through `IOUtils`, so a hostile process running as the same macOS user could still swap a checked path before the later open. The bridge checks the path before and after each read and again before dispatch, but those checks do not remove that operating-system race. Keep the bridge in a dedicated directory owned by the user and do not share write access with untrusted processes.

## Development native-host evidence and remaining checks

Actual checks ran on 2026-10-21 against Zotero 10.0.6 with a development-only composition. Mac Safe Files calls from Codex completed `connection_status` and the native annotation creation described above. Direct Codex file requests also completed search and read operations, appended to the native annotation, rejected a stale edit after a real manual comment change with `conflict`, and rejected a changed stored PDF with `stale_attachment`.

The running host ignored incomplete publication and rejected malformed JSON, the wrong profile, oversized input, and a symlinked request before native dispatch. Disable stopped new dispatch. A pending `create_note` placed in disabled session prefix `4a6ae…` produced neither a result nor a note; after reconnect selected session prefix `678aa…`, listing notes confirmed that the pending mutation remained absent. This is actual evidence for disable/reconnect freshness, not evidence for crash recovery or reinstall behavior.

That historical development composition contained file-bridge source `f1c477d` and native adapter source `12d8b2a`. It did not establish distribution readiness. Later production-package checks used a user-selected directory, passed disable/remove/reinstall retention and historical retry protection, and reconciled a real native commit interrupted before result finalization. This was fault injection, not a forced application crash.

The actual Web session described above passed native storage and visible native-editor verification. Fresh-session strict formatted-preview checks also passed twice; activating another PDF tab correctly failed viewer confirmation. The integrated storage-safety fixes passed 160 automated tests, clean deterministic packaging, and actual native note preservation and size-limit checks on 2026-10-22. ChatGPT Work remains independently unverified. There is no public Mac Safe Files installer in this repository, and public publication was not performed.
