# Build and local lifecycle

Use Node.js 24–26 and npm 11.4.2. A fresh checkout has two lockfiles:

```sh
npm ci
npm ci --prefix integration/zotero-mcp --ignore-scripts
npm run verify
```

The root install builds and validates the XPI and package tooling. The nested
install supplies the dedicated server's independently locked runtime. Do not run
`npm install` or `npm ci` through a shared/symlinked `node_modules`; detach it and
perform an owned clean install first.

`npm run package` generates four version-aligned artifacts: XPI, generic client
folder, unconfigured plugin ZIP, and MCP server ZIP. Archives use sorted explicit
inventories, fixed timestamps, `zip -X`, per-member server hashes, and locked
dependency/license metadata. `npm run verify:package` relocates the server,
performs `npm ci --omit=dev --ignore-scripts`, and uses the official MCP SDK to
initialize stdio and discover exactly 14 tools. Never distribute a configured
account archive.

Zotero settings remain `extensions.zotero-ai-research-companion.enabled` and
`extensions.zotero-ai-research-companion.bridgeDirectory`. The managed server
receives that root through its owned process environment. Its private lifecycle
config stores a credential file reference, never key contents. Installation,
status, rollback, and removal belong to [install](install.md) and
[uninstall](uninstall.md).

The installed release records the exact dependency tree shape, and the private
profile directory admits only the fixed managed profile YAML. Lifecycle removal
fails before tunnel changes if either tree contains an unknown entry. The
tunnel client's pinned global state root remains outside lifecycle ownership.

Keep `<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json` through
ordinary reinstall. It contains private study text and historical identities,
not a disposable cache. Preserve `<BRIDGE_ROOT>/sessions/` as well. New sessions
do not authorize replaying pending writes.

For native acceptance use an owned PDF, an explicitly selected Web plugin,
a local PDF read, and a requested save with fresh native readback and actual
reader observation. Verify only the behavior changed; do not generate entire
proof conversations to test whether arbitrary discussion can be copied exactly.
A model preparation check and a native persistence check answer different
questions. Evidence from local Codex files cannot establish ChatGPT Work access.

The manifest's reserved `.invalid` update URL satisfies Zotero's install
requirement without creating an updater. Distribution remains manual; a public
release channel, stable authenticated HTTPS/user-profile routing, end-user
runtime lifecycle, and project distribution license remain separate decisions.
