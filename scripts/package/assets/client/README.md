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

## Starter prompt

Replace `<BRIDGE_ROOT>` below with the exact absolute directory displayed by
Zotero, then give the resulting prompt to the local-file client:

> Use local file access to connect to the Zotero Research Companion rooted at
> `<BRIDGE_ROOT>`. First read `<BRIDGE_ROOT>/client-v1/README.md` and
> `<BRIDGE_ROOT>/client-v1/protocol/v1.md`. Validate requests against the
> packaged request schema and examples. Read the current `bridge-v1.json`, then
> perform the descriptor-status-descriptor check before every publication.
> Require the descriptor and status to identify the same profile and session.
> Start with one `connection_status` request in that session and require its
> response `data.profile.id` to match the descriptor profile. Do not publish a
> mutation unless I explicitly request it or approve its exact content and
> target. Use only the session and relative paths in the current descriptor,
> and never copy a stale pending request into a new session.

For Mac Safe Files, keep its action policy at **Always ask** and authorize only
the dedicated bridge directory. A direct Codex local-file route completed real
round trips in the project validation environment. ChatGPT Work local-file
availability and full ChatGPT Web acceptance remain independently unverified.

No model API key, tunnel key, or credential belongs in this directory. The
client must create a complete request atomically, poll only its matching result,
and keep the same operation ID and byte-equivalent payload when recovering an
uncertain operation. Read `docs/troubleshooting.md` before changing any files by
hand.
