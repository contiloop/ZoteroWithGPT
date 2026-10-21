# Install and set up on macOS

This release supports Zotero 10.0.6 through 10.0.x on macOS. It uses local
protocol-v1 request and result files. It does not need a model API key and does
not contain an automatic update service.

## Install the XPI

1. Download the versioned `zotero-ai-research-companion-<version>.xpi` file.
2. In Zotero, choose **Tools → Plugins**.
3. Open the gear menu, choose **Install Plugin From File…**, and select the XPI.
4. Confirm the installation when Zotero asks.

If Zotero reports that a newer development build is already installed, remove
that development build in the Plugins Manager, then install the versioned
release XPI. This does not delete Zotero annotations, notes, or the companion's
operation identity journal.

The package is distributed manually. To update it, download the next versioned
XPI and install it from the Plugins Manager. Do not add an update URL or use an
unverified replacement package.

## Select the local bridge directory

Create one empty directory for this Zotero profile. The directory is the
authority boundary for client request and result files, so do not select your
home directory, Desktop, Zotero data directory, a synced research folder, or a
directory used by another plugin. Do not share write access with an untrusted
local account or process.

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

## Connect a local-file client

The XPI includes `protocol/v1.md`, a JSON request schema, and complete request
examples. The two currently documented client routes are:

- **Direct Codex local files:** start a local Codex task that has access to the
  selected directory, then have it follow the descriptor-status-descriptor
  handshake and protocol-v1 filename rules. This route completed real local
  round trips in the project validation environment. A different Mac may show
  an access prompt or deny the directory under its own policy.
- **Mac Safe Files MCP:** use it only when the connection owner or administrator
  has already supplied its versioned server package and setup runbook. Give it
  access only to the selected directory and keep its action policy at
  **Always ask**. This repository does not contain a public installer for that
  server. Do not copy another person's tunnel profile, runtime key, credential
  files, or organization configuration.

For either route, the client must read the relative paths and limits from the
current descriptor instead of guessing them. Publish a complete request with a
create-only atomic write, then poll only the matching result path. Mutations
require a current explicit request or approved proposal from the user.

ChatGPT Work local-file availability has not been independently verified. A
successful Codex or MCP run does not prove Work access. Full ChatGPT Web
acceptance also remains a separate end-to-end check; do not infer it from local
installation or package verification.

## Confirm the setup

Run `connection_status` first. Require the response profile ID and protocol
version to match the current descriptor and require `enabled: true`. A healthy
setup has all of the following:

- the Zotero settings dialog shows the intended directory and **Ready**;
- `bridge-v1.json`, its status file, and the response report the same profile
  and session;
- the request and result directories are relative to the selected root; and
- no API key, tunnel key, or credential appears in the directory.

Use a new operation ID for new approved content. When recovering an uncertain
or interrupted operation, reuse the exact same operation ID and payload. The
durable identity journal prevents a completed native write from being repeated
after an ordinary reconnect, update, or reinstall.
