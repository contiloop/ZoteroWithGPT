# Research Companion local client kit

Package version: `{{PACKAGE_VERSION}}`

This folder contains the plain UTF-8 guide, schemas, and examples for a local
file client. It matches the XPI with the same version. It is reference material;
Zotero does not execute files from this folder.

## Copy the kit into the dedicated bridge directory

1. Create the dedicated bridge directory described in `docs/install.md`.
2. In that directory, create a folder named `client-v1`.
3. In Finder, open this versioned client folder and copy every item inside it
   into `client-v1`.
4. Confirm that this exact file exists:

   ```text
   <BRIDGE_ROOT>/client-v1/README.md
   ```

5. In Zotero, select `<BRIDGE_ROOT>` itself and choose **Enable**. Do not select
   the `client-v1` child folder.

After Enable, the important paths are:

```text
<BRIDGE_ROOT>/bridge-v1.json
<BRIDGE_ROOT>/client-v1/README.md
<BRIDGE_ROOT>/client-v1/protocol/v1.md
<BRIDGE_ROOT>/client-v1/protocol/v1-request.schema.json
<BRIDGE_ROOT>/client-v1/protocol/v1-response.schema.json
<BRIDGE_ROOT>/client-v1/protocol/examples/
```

## Publish and read one operation

1. Read `<BRIDGE_ROOT>/bridge-v1.json` and keep the complete descriptor.
2. Read `<BRIDGE_ROOT>/<statusFile>`, using the relative `statusFile` value from
   that descriptor. Require bridge version 1, protocol version 1, matching
   profile and session IDs, and `enabled: true`.
3. Read `<BRIDGE_ROOT>/bridge-v1.json` again and require the complete descriptor
   to be unchanged. Stop if it changed or the selected status became disabled.
4. Build one complete request with an operation ID that matches
   `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and the packaged request schema.
   Use a fresh ID for every new observation, including reads, status checks,
   and verification. Reusing an ID returns its recorded historical result.
   Before assigning an annotation-mutation ID, prepare its complete final
   comment in Unicode NFC with no leading or trailing whitespace. Exclude an
   incidental file-terminator newline while preserving substantive interior
   newlines and indentation. If this preparation changes an already approved
   body, review and authorize the exact prepared body and use a fresh ID; do
   not silently trim meaningful content.
5. Publish it with a create-only atomic write at exactly:

   ```text
   <BRIDGE_ROOT>/<requestDirectory>/<operationId><requestSuffix>
   ```

6. Poll only the corresponding path:

   ```text
   <BRIDGE_ROOT>/<resultDirectory>/<operationId><resultSuffix>
   ```

7. Parse the complete result and require its `protocolVersion` and `operationId`
   to match the request. Stop using the session if the descriptor changes or
   its selected status becomes disabled. Recover an uncertain operation only
   with the same operation ID and byte-equivalent payload in the current
   session after renewed authorization.

If recovery explicitly rejects an interrupted queued operation as never
executed and not written, re-read the target and obtain renewed mutation
approval before submitting a new ID. An unknown outcome must retain its ID.
A terminal `indeterminate` result is historical evidence: do not republish the
mutation under that or a new ID, even when a later search does not find its
planned native key.

## Local arXiv study route

The selected **Zotero Study Save** plugin expects the user to have saved the
paper and PDF manually in Zotero. It receives one official arXiv abstract or
PDF link at the start of the conversation, then performs connection and local
lookup internally. The user does not supply a connection phrase, bridge path,
request file, profile, library, item key, or attachment key.

Protocol v1 defines 15 operations and 5 mutations. For this route, require
`find_local_arxiv` in the fresh `connection_status` capability list. The
`inspect_arxiv` read and `ensure_arxiv_pdf` mutation remain in the contract only
for backward compatibility and historical results. Never invoke them, a
downloader, or another acquisition path to repair a missing paper or PDF,
including after the user asks to save study material.

Send `find_local_arxiv` as an authorization-free profiled read with
`{ "url": <official-arxiv-url>, "limit": 25 }`. It searches all eligible
libraries offline. Parent metadata identifies a candidate, not PDF bytes or a
PDF version. Attachment provenance is trusted only when its fingerprint equals
that same attachment's current fingerprint. Null version evidence remains
unknown, and an unversioned URL is not a latest-version request.

Multiple parents or PDFs, conflicting or truncated evidence, an access failure,
or an explicit-version mismatch requires focused clarification by useful title,
version, or attachment name. Never select the first or latest result or ask the
user to choose an internal native key. A user may confirm the actual PDF when
metadata is incomplete, but that does not create version evidence.

When the item is missing, ask the user to save the paper and PDF manually in
Zotero and wait. When only metadata exists or access fails, ask the user to add
the PDF or restore access and wait. Then perform a fresh `find_local_arxiv` and
a fresh `read_pdf`. An empty lookup proves only that no identifier evidence was
found. Standalone PDFs outside a parent paper item are outside this lookup.

When the selected attachment has no current fingerprint, its local bytes are
inaccessible or unverified. Do not invoke `read_pdf` or another read to repair
it. Ask the user to restore the file or attachment path manually in Zotero and
wait. Perform a fresh `find_local_arxiv` after restoration, and call `read_pdf`
only when that result supplies a current fingerprint for the attachment.

A study target is established only after discovery and successful reading of
the actual local PDF. Retain its profile, library, item, attachment, fingerprint,
and version evidence only in accessible conversation context. Refresh the
descriptor, status, descriptor, and native target evidence before a write.
Reading and study require no mutation approval; only the current user's explicit
save request or acceptance of an exact proposal authorizes a native write.

## Starter prompt

The configured personal ChatGPT plugin reads this kit internally and stores the
bridge root once in its private `personal-config.json`. Do not paste this
starter prompt or path into each ordinary ChatGPT conversation. Use the prompt
only for a direct local-file client or bounded connection diagnosis.

For that alternate route, replace `<BRIDGE_ROOT>` below with the exact absolute
directory displayed by Zotero, then give the resulting prompt to the client:

> Use local file access to connect to the Zotero Research Companion rooted at
> `<BRIDGE_ROOT>`. First read `<BRIDGE_ROOT>/client-v1/README.md` and
> `<BRIDGE_ROOT>/client-v1/protocol/v1.md`. Validate requests against the
> packaged request schema and examples. Follow the README's **Publish and read
> one operation** procedure for every publication.
> Require the descriptor and status to identify the same profile and session.
> Start with one `connection_status` request in that session and require its
> response `data.profile.id` to match the descriptor profile. Do not publish a
> mutation unless I explicitly request it or approve its exact content and
> target. Use only the session and relative paths in the current descriptor,
> and never copy a stale pending request into a new session.

For Mac Safe Files, keep its action policy at **Always ask** and authorize only
the dedicated bridge directory. The private ChatGPT plugin keeps only that
root; it rediscovers the current profile, session, and relative paths for each
workflow. Direct Codex local files remain an alternate client. ChatGPT Work
local-file availability remains independently unverified. Confirm access on
each account and Mac.

No model API key, tunnel key, or credential belongs in this directory. The
client must create a complete request atomically, poll only its matching result,
and keep the same operation ID and byte-equivalent payload when recovering an
uncertain operation. Read `docs/troubleshooting.md` before changing any files by
hand.
