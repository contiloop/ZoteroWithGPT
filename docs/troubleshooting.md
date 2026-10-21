# Troubleshooting

Start with **Tools → Research Companion Settings…**. Record the displayed
state, selected directory, session ID, and detail. These diagnostics contain no
API key because this plugin does not use one.

## The settings item is missing

Open **Tools → Plugins** and confirm that **Zotero AI Research Companion** is
installed and enabled. This release supports Zotero 10.0.6 through 10.0.x.
Close and reopen the main Zotero window after enabling the plugin. If the XPI
was rejected as an older version, remove the installed development build and
install the versioned release manually.

## The connection is Disabled

Choose a dedicated directory, then choose **Enable**. Directory selection alone
does not enable processing. If a directory is already shown, Enable starts a
fresh session. **Reconnect** closes the current session and starts another
fresh session in the same directory.

## Enable reports an error

The selected root must already exist and be an absolute canonical directory. It
cannot be a symbolic link. The current macOS user must be able to create private
subdirectories and files there. Select a new empty dedicated directory instead
of changing permissions on a shared directory.

If the directory was moved, renamed, replaced by a link, or removed after
enable, disable the connection, restore or select a valid dedicated directory,
and enable again. Do not repair the setup by editing `bridge-v1.json` or a
session status file manually.

## Status is Ready but no result appears

First confirm that the local client can read
`<BRIDGE_ROOT>/client-v1/README.md`. If it cannot, copy the contents of the
matching versioned client folder into `<BRIDGE_ROOT>/client-v1` with Finder.
Do not point the client at the compressed XPI and do not select `client-v1` as
the bridge root.

Check the client in this order:

1. Read `bridge-v1.json` from the selected root.
2. Read the exact relative `statusFile` it publishes.
3. Require matching bridge version, protocol version, profile ID, and session
   ID, with `enabled: true`.
4. Read `bridge-v1.json` again and require the complete descriptor to be
   unchanged.
5. Publish the complete request atomically to the exact current
   `requestDirectory` with the published `.request.json` suffix.
6. Poll only the matching path under the current `resultDirectory`.

Do not select a session by modification time. Do not append to a final request,
overwrite it, or copy an old pending request into a new session. A mutation
request also needs nonempty authorization metadata reflecting the user's
current instruction.

When the descriptor changes or its status becomes disabled, stop polling that
session. After renewed authorization, recover an uncertain operation with the
same operation ID and byte-equivalent payload in the current session.

## A request is rejected

- `invalid_request` or `unsupported_version`: validate the complete JSON
  against the packaged protocol-v1 schema and use only documented fields.
- `permission_denied`: use the current profile ID; for a mutation, record the
  user's explicit request or approved proposal in `authorization`.
- `duplicate_id_mismatch`: the operation ID already identifies different
  content. Do not alter its historical record. Use a new ID only for newly
  authorized changed content or target.
- `conflict`: a person or sync changed the annotation or note after it was
  read. Read it again and obtain renewed approval before a new operation.
- `stale_attachment`: the PDF changed. Read the attachment and resolve the
  passage again.
- `unresolved_anchor`: the current reader evidence is missing or ambiguous.
  Ask the user to select or identify the passage; do not guess a candidate.
- `too_large`: obey the size limit published in the current descriptor and the
  field limits in `protocol/v1.md`. Do not truncate approved content silently.

An `indeterminate` result means the native outcome is unknown. Do not retry it
under a new ID. Keep its original identity and follow the recovery rules above.

## A native save exists but viewer verification failed

Storage and reader evidence are separate. If the result is `succeeded` with
`verification.storage: "confirmed"`, do not repeat the write. A closed,
background, or unavailable PDF reader can make viewer verification fail even
though the native Zotero record is saved. Open the target PDF and inspect the
annotation before requesting a separate verification operation.

## Disable or uninstall behavior is unclear

Disable prevents new dispatch in the selected session, but a request that was
already dispatched can finish. The active status file is authoritative. The
uninstall procedure retains native records and the operation identity journal;
see `uninstall.md` for the exact optional transient files and preference keys.

Do not delete Zotero data, other plugin files, an MCP server, or a tunnel while
diagnosing this XPI. Mac Safe Files and tunnel setup belong to their owner's
runbook. ChatGPT Work remains independently unverified, and local package
success does not establish ChatGPT Web end-to-end acceptance.
