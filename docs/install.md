# Install and set up on macOS

This release supports Zotero 10.0.6 through 10.0.x on macOS. It uses local
protocol-v1 request and result files. It does not need a model API key and does
not contain an automatic update service.

Obtain the three matching items from the release bundle:

```text
zotero-ai-research-companion-<version>.xpi
zotero-ai-research-companion-<version>-client/
zotero-study-save-<version>.zip
```

The second item is an ordinary folder of plain UTF-8 client instructions,
schemas, and examples. The ZIP is the portable source for the private personal
ChatGPT plugin. Keep all three items at the same version. The portable ZIP has
`bridgeRoot` set to `null`; a configured account copy is private and is not a
replacement distribution artifact.

## Install the XPI

1. Locate the versioned `zotero-ai-research-companion-<version>.xpi` file.
2. In Zotero, choose **Tools → Plugins**.
3. Open the gear menu, choose **Install Plugin From File…**, and select the XPI.
4. Confirm the installation when Zotero asks.

If Zotero reports that a newer development build is already installed, remove
that development build in the Plugins Manager, then install the versioned
release XPI. This does not delete Zotero annotations, notes, or the companion's
operation identity journal.

The package is distributed manually. To update it, obtain the next matching XPI
and client folder, then install the XPI from the Plugins Manager. Zotero requires
every installable extension manifest to contain an update URL, so this package
uses the reserved no-service address
`https://updates.invalid/zotero-ai-research-companion/updates.json`. The
`.invalid` name cannot provide an update service. Do not replace it with a real
host or use an unverified replacement package.

## Select the local bridge directory

Create one new dedicated directory for this Zotero profile. The directory is the
authority boundary for client request and result files, so do not select your
home directory, Desktop, Zotero data directory, a synced research folder, or a
directory used by another plugin. Do not share write access with an untrusted
local account or process.

Before enabling the connection, copy the client kit with Finder:

1. Inside the dedicated directory, create a folder named `client-v1`.
2. Open `zotero-ai-research-companion-<version>-client` and copy every item
   inside it into `client-v1`.
3. Confirm that `<BRIDGE_ROOT>/client-v1/README.md` exists, where
   `<BRIDGE_ROOT>` means the dedicated directory. Do not select `client-v1` as
   the bridge root.

1. Choose **Tools → Research Companion Settings…**.
2. Choose **Choose Directory…** and select the dedicated existing directory.
3. Review the displayed absolute directory.
4. Choose **Enable**.
5. Require the status to show **Ready** and record the displayed session ID.

Enable and Reconnect each allocate a fresh unpredictable session. The root
`bridge-v1.json` file selects that session. Its published `statusFile` must
identify the same session and contain `"enabled": true` before a client writes
a request. A client must reread `bridge-v1.json` after reading the status file
and require the descriptor to be unchanged.

Choose **Disable** before changing the directory. A new selection is not used
until Enable is chosen explicitly.

## Set up the personal ChatGPT plugin once

The normal ChatGPT Web route uses the private **Zotero Study Save** personal
plugin and the already authenticated **Mac Safe Files** app. This repository
does not contain a public Mac Safe Files installer, account credential, tunnel,
or connection policy. Use the connection owner's supported setup before this
step.

1. In ChatGPT's supported personal-plugin creation flow, create a private
   plugin from `zotero-study-save-<version>.zip`.
2. Keep the archive's Mac Safe Files dependency. Approve only the dedicated
   bridge root through the platform and macOS permission surfaces; those
   decisions remain authoritative.
3. In that private plugin instance, set only
   `skills/zotero-study-save/resources/personal-config.json` → `bridgeRoot` to
   the exact absolute root shown by Zotero. Do not add a profile ID, session
   ID, descriptor, operation ID, credential, or study content.
4. Manually save the paper and its PDF in Zotero. Confirm that the private
   plugin is installed and enabled, start a fresh ChatGPT conversation,
   explicitly select **Zotero Study Save**, provide one official arXiv abstract
   or PDF URL, and ask to study the paper from the PDF already in Zotero.
   Selection is required for the initial 0.3.0 workflow; automatic invocation
   remains an optional convenience rather than an installation test.

The plugin discovers the current descriptor, enabled status, profile, session,
relative paths, limits, and supported operations on every workflow. Users do
not paste the bridge path or repeat a manual connection command in each
conversation. Configuring the root or selecting the plugin does not authorize a
Zotero write. Initial discovery and local PDF reading are read-only; a later
current save request or acceptance of an exact save proposal is required for
the specified records. The workflow does not download or import a missing PDF.
An attachment without a current fingerprint stops before `read_pdf`; restore
its file or path in Zotero and let the plugin run fresh discovery rather than
using another read as repair.

## Other local-file clients

The XPI and matching plain-text client kit include `protocol/v1.md`, request and
response schemas, and complete examples. Replace `<BRIDGE_ROOT>` in the starter
prompt in `<BRIDGE_ROOT>/client-v1/README.md` with the exact absolute directory
displayed by Zotero only when using a direct local-file client instead of the
personal ChatGPT plugin. The documented alternatives are:

- **Direct Codex local files:** start a local Codex task that has access to the
  selected directory, then have it follow the descriptor-status-descriptor
  handshake and protocol-v1 filename rules. This route completed real local
  round trips in the project validation environment. A different Mac may show
  an access prompt or deny the directory under its own policy.
- **Mac Safe Files without the personal workflow:** use it only for bounded
  diagnosis when the connection owner or administrator has already supplied
  its versioned package and setup runbook. Give it access only to the selected
  directory and keep its action policy at **Always ask**. Ordinary ChatGPT Web
  use should go through the configured personal plugin so the user does not
  need to paste the root or protocol instructions.

For either route, the client must read the relative paths and limits from the
current descriptor instead of guessing them. Publish a complete request with a
create-only atomic write, then poll only the matching result path. Mutations
require a current explicit request or approved proposal from the user.

ChatGPT Work local-file availability has not been independently verified. A
successful Codex, personal-plugin, or MCP run does not prove Work access. A new
account or Mac requires its own private plugin, connection check, and reader
check; package verification alone does not establish account activation or
native viewer behavior.

## Confirm the setup

Run `connection_status` first. Require the response profile ID and protocol
version to match the current descriptor and require `enabled: true`. A healthy
setup has all of the following:

- the Zotero settings dialog shows the intended directory and **Ready**;
- `<BRIDGE_ROOT>/client-v1/README.md` is readable by the chosen local client;
- the personal plugin is enabled with Mac Safe Files connected and its private
  `bridgeRoot` equals the exact dedicated root;
- `bridge-v1.json` and its status file report the same profile and session;
- the `connection_status` response read from that session's result directory
  has a `data.profile.id` matching the descriptor profile and advertises all 15
  operations, including `find_local_arxiv`;
- the request and result directories are relative to the selected root; and
- no API key, tunnel key, or credential appears in the directory.

Use a fresh operation ID for every new operation, including reads, status
checks, verification, and new approved content. Reusing an ID returns its
recorded historical result. When recovering an uncertain
or interrupted operation, reuse the exact same operation ID and payload. The
durable identity journal prevents a completed native write from being repeated
after an ordinary reconnect, update, or reinstall.

An interrupted queued operation is rejected without being executed. After that
definitive non-writing result, re-read the target and obtain renewed mutation
approval before submitting a new ID. Keep the original ID for unknown outcomes.
A terminal `indeterminate` result is historical evidence, not a prompt to
publish the mutation again or substitute a new ID.
