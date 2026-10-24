# Install on macOS

Version 0.5.0 requires Zotero 10.0.6–10.0.x, Node.js 24–26, npm
11.4.2, the reviewed `tunnel-client` 0.0.14 build, an existing private tunnel
ID, and its protected runtime-key file. Obtain all four matching artifacts:

- `zotero-ai-research-companion-0.5.0.xpi`
- `zotero-ai-research-companion-0.5.0-client/`
- `zotero-study-save-0.5.0.zip`
- `zotero-mcp-server-0.5.0.zip`

The plugin ZIP is deliberately **UNCONFIGURED**. It has no account app binding
and cannot connect until the private configuration step succeeds.

## Reviewed tunnel client and private tunnel

Use the full `tunnel-client` from the official pinned
[v0.0.14 release](https://github.com/openai/tunnel-client/releases/tag/v0.0.14),
not an unpinned latest download or the narrower runtime-only binary. Download
the matching `tunnel-client-v0.0.14-darwin-arm64.zip` or
`tunnel-client-v0.0.14-darwin-amd64.zip` and `SHA256SUMS.txt`, then verify that
archive against the published release checksum before extracting it. The accepted
binary must report both the release and reviewed revision:

```text
0.0.14+0f870e50a973fa820d4c409000059e181e8d242b
```

The installer enforces that revision. If macOS blocks the official archive,
follow the release's supported installation guidance and organizational policy;
do not bypass Gatekeeper. Recheck `tunnel-client --version` afterward.

In [Platform Tunnels](https://platform.openai.com/settings/organization/tunnels),
create or select a tunnel identity dedicated to this Zotero MCP. Record its
existing tunnel ID. Use the protected regular file that already references its
runtime credential, with user-only permissions. Do not paste, copy, rotate, or
print the credential value during this install. Leave any older shared Mac
tunnel, profile, and account route unchanged.

## Zotero and bridge

1. In **Tools → Plugins → gear → Install Plugin From File…**, select the XPI.
2. Create a dedicated bridge root outside the Zotero data directory, profile,
   home root, and MCP runtime root. Restrict it to the current user.
3. In **Tools → Research Companion Settings…**, choose that root, select
   **Enable**, and require **Ready**.

Keep Zotero running for request processing. Directory selection alone does not
enable processing. The MCP server discovers the active session; do not copy or
reissue pending files from an older session.

The generic client folder is a separate fallback for a deliberately configured
local-file client. If needed, copy it to `<BRIDGE_ROOT>/client-v1` and follow its
README. Do not add it to the selected ChatGPT plugin.

## Locked MCP runtime

Extract the server ZIP into a temporary directory, then install its production
dependencies from the included lockfile:

```sh
cd "<EXTRACTED_SERVER_ROOT>"
npm ci --omit=dev --ignore-scripts
```

Choose a stable, empty `<OWNED_RUNTIME_ROOT>` outside the bridge and Zotero
profile. The installer accepts symlinked Node and tunnel-client commands, resolves
them to canonical executable files, and stores those canonical paths. The
credential argument must remain a `file:` reference to a regular user-only file.
Every component of the install, bridge, credential, and resolved tunnel-client
control paths must be non-symlinked. Supply their canonical paths; on macOS this
also means resolving aliases such as `/tmp` to `/private/tmp` with `realpath`.
Executable command paths are the intentional symlink exception.

```sh
node integration/zotero-mcp/lifecycle.mjs install \
  --install-root "<OWNED_RUNTIME_ROOT>" \
  --bridge-root "<BRIDGE_ROOT>" \
  --independent-node "<NODE_24_TO_26>" \
  --tunnel-client "<TUNNEL_CLIENT>" \
  --tunnel-id "<EXISTING_PRIVATE_TUNNEL_ID>" \
  --runtime-api-key-reference "file:<PROTECTED_RUNTIME_KEY_FILE>"

node "<OWNED_RUNTIME_ROOT>/bin/zotero-mcp-lifecycle.mjs" start \
  --install-root "<OWNED_RUNTIME_ROOT>"
node "<OWNED_RUNTIME_ROOT>/bin/zotero-mcp-lifecycle.mjs" status \
  --install-root "<OWNED_RUNTIME_ROOT>"
```

Use `--control-plane-base-url` and `--control-plane-url-path` during install only
when they match the existing private tunnel source. A successful status reports
`processRunning`, `healthy`, and `ready` as true. The fixed local alias/profile is
`zotero-study-save-mcp`; the managed client owns its ephemeral loopback health
port. These commands do not create, change, or delete the remote tunnel.

At install time the lifecycle resolves the reviewed client's global state root
using its pinned 0.0.14 precedence, stores the canonical result, and passes that
same root to every child command through `TUNNEL_CLIENT_STATE_DIR`. The install
and bridge roots must stay outside it. The lifecycle manages only its fixed
alias and private profile YAML; it never recursively deletes the shared global
state root or its other runtimes.

## ChatGPT MCP app and private plugin binding

After the managed runtime reports ready, create a dedicated custom MCP app in
ChatGPT through the normal account UI and enter the same existing tunnel ID in
the form's **Tunnel ID** field. Obtain the created app's real ID from that
account record; do not invent an ID or endpoint. The 0.5.0 live acceptance must
still verify this ChatGPT form path and resulting tool discovery.

Export the current `zotero-study-save` plugin source through the normal account
plugin management tool. Before any update, keep a private backup of that source,
including its two manifests and old route resources. Portable release artifacts
do not contain this account state and cannot recreate it.

Keep the portable ZIP unchanged. The server artifact includes the configuration
helper, so a source checkout is not required. Create a protected output
directory, then build a separate private archive using the verified dedicated
MCP app ID and the exported current account source:

```sh
mkdir -m 700 "<PRIVATE_DIRECTORY>"
umask 077
node "<EXTRACTED_SERVER_ROOT>/scripts/package/configure-plugin.mjs" \
  --portable-plugin "<PORTABLE_PLUGIN_ZIP>" \
  --account-source "<CURRENT_ACCOUNT_PLUGIN_SOURCE>" \
  --app-id "<VERIFIED_DEDICATED_MCP_APP_ID>" \
  --output "<PRIVATE_DIRECTORY>/zotero-study-save-configured.zip" \
  > "<PRIVATE_DIRECTORY>/configuration-result.json"
```

The helper reads only the portable allowlist plus `plugin.json` and
`.codex-plugin/plugin.json` from the account source. It preserves the account's
interface presentation and default prompt, adds `.app.json`, and emits a 0600
archive. Its JSON output also lists every existing obsolete account file that an
overlay update must delete exactly, including files below the old `client-v1`
prefix and `personal-config.json`. Do not replace that exact list with a
directory path. Apply the configured ZIP to the existing plugin through the
guarded account update tool, with those exact file paths as deletions. This
preserves the plugin identity while preventing omitted legacy files from
surviving the overlay.

Account updates reject lower semantic versions and may auto-increment an
unchanged version. If the guarded account state requires a higher version, pass
`--release-version <GREATER_VERSION>` deliberately. Keep the configured archive
and `configuration-result.json` with the private account backup. If the exported
source is later removed, an extracted configured archive supplies the preserved
manifest presentation for another configuration run; the saved result remains
the authoritative deletion list for a first overlay against the old source.
These files do not restore bridge sessions or native operation history. Preserve
those stores in place and never manufacture replacement history. Installing and
exercising the actual account binding belongs to the live acceptance step; the
portable archive alone is not evidence of connectivity.

After configuration, manually save the paper and PDF in Zotero. Select
**Zotero Study Save**, provide its official arXiv link, and ask to study it.
Selection and study are read-only; only a later requested save writes native
annotations.
