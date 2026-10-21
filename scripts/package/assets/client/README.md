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

## Starter prompt

Replace `<BRIDGE_ROOT>` below with the exact absolute directory displayed by
Zotero, then give the resulting prompt to the local-file client:

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
the dedicated bridge directory. Both actual ChatGPT Web with Mac Safe Files and direct Codex local files
completed real study-comment saves, readback, and visible native-editor checks
in the project validation environment. ChatGPT Work local-file availability
remains independently unverified. Confirm access on each account and Mac.

No model API key, tunnel key, or credential belongs in this directory. The
client must create a complete request atomically, poll only its matching result,
and keep the same operation ID and byte-equivalent payload when recovering an
uncertain operation. Read `docs/troubleshooting.md` before changing any files by
hand.
