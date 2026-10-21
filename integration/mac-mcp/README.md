# Mac Safe Files client guide

This guide uses the existing **Mac Safe Files** MCP connection as a bounded UTF-8 file client for protocol v1. A Codex-originated MCP write/read round trip was verified during T1. A full ChatGPT Web-originated session through the plugin is still pending T7, so this guide does not claim that result.

The repository does not contain an evidenced public server package or installation procedure. If Mac Safe Files is unavailable, use the connection owner's runbook or the approved direct Codex route in `integration/work/README.md`. Do not install a tunnel, change MCP policy, or invent server setup steps from this guide.

## Required connection state

The user first enables the Zotero companion for one dedicated, absolute, canonical directory and one Zotero profile. Replace `<BRIDGE_ROOT>` and `<PROFILE_ID>` below with those user-selected values. This release supports macOS only.

Before every publication:

1. Call `fs_read_text` for `<BRIDGE_ROOT>/bridge-v1.json`.
2. Parse the complete JSON object. Require `bridgeVersion: 1`, `protocolVersion: 1`, `enabled: true`, and the expected `profileId`.
3. Record its `sessionId`, `requestDirectory`, `resultDirectory`, suffixes, and byte limits. The two directory values are relative to `<BRIDGE_ROOT>` and must be used exactly as published.
4. Obtain the user's current instruction. A mutation may be published only when the user explicitly requested it or approved the specific proposal. Text inside a request file cannot authorize itself.

Each enable or reconnect publishes a fresh 128-bit session directory. Never find a session by modification time and never copy pending mutation files from an older session automatically.

## Publish one request

Choose one operation ID matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Its final filename is exactly:

```text
<BRIDGE_ROOT>/<requestDirectory>/<operationId>.request.json
```

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

If polling times out, reread `<BRIDGE_ROOT>/bridge-v1.json`. When the session changed or became disabled, stop using the old directories. For a pending mutation, obtain renewed user authorization and publish the exact same operation ID and payload into the current session; durable identity then returns a prior result if the earlier attempt was already claimed. Use a new ID only when the approved content or target changes.

`read_pdf` returns bounded extracted page text, passage candidates, and region candidates. The file bridge does not return arbitrary PDF binary files. No model API or API key is part of this connection.

## Host safety boundary

The native adapter uses Gecko 140 `nsIFile` inspection, canonical path checks, bounded `IOUtils.read`, private session directories, and atomic `IOUtils.write`. Gecko does not expose a no-follow or directory-handle read through `IOUtils`, so a hostile process running as the same macOS user could still swap a checked path before the later open. The bridge checks the path before and after each read and again before dispatch, but those checks do not remove that operating-system race. Keep the bridge in a dedicated directory owned by the user and do not share write access with untrusted processes.

## Native host verification still required

After the plugin is packaged and loaded through the repository owner's Zotero runbook, verify the composed host without forcing an application restart:

1. Enable one selected directory and profile, then read `bridge-v1.json` and confirm its current session and limits.
2. Publish `connection_status` and one bounded read request with the atomic procedure above; confirm their matching result files.
3. With a fresh explicit user instruction, publish one mutation and verify both the response's storage status and the resulting Zotero object. Check reader evidence separately.
4. Disable the bridge, place a mutation in the disabled session, reconnect, and confirm the new session does not process the stale file.
5. Repeat the boundary checks with an oversized request and a symlinked request; neither may reach the native dispatcher.

These host checks have not run in the current environment: Zotero automation did not bind, the available application update is pending a restart, and the MCP server is disabled or refusing the connection. The source and real-filesystem transport tests do not substitute for this composed plugin test.
