# Dedicated Zotero MCP server

This Node.js stdio server exposes the fixed 14-tool Zotero Study Save contract.
It adapts MCP calls to the existing protocol-v1 file bridge; Zotero remains the
only native executor and owns authorization, mutation, readback, recovery, and
`operations-v1.json`. The server has no public listener, model API, acquisition
path, or generic filesystem tools.

The nested `package.json` and lockfile require Node.js 24–26, npm 11.4.2,
`@modelcontextprotocol/sdk` 1.32.2, DOMPurify 3.4.17, and jsdom 29.1.1. A clean
development setup uses:

```sh
npm ci --prefix integration/zotero-mcp --ignore-scripts
npm run typecheck --prefix integration/zotero-mcp
npm test --prefix integration/zotero-mcp
```

Release packaging derives a minimal local import graph, includes the shared
compiled native/protocol helpers and schemas, and emits a root production lock
whose dependencies resolve after relocation. Full package verification extracts
the ZIP elsewhere, performs a production `npm ci`, starts it through the
official SDK stdio client, and requires the exact tool inventory.

The same server artifact contains `scripts/package/configure-plugin.mjs`, so
private plugin reconfiguration does not depend on retaining a development
checkout. It still requires the unconfigured portable ZIP plus preserved private
account manifests; release artifacts cannot reconstruct deleted account state.

`lifecycle.mjs` installs that clean extracted package under one fenced stable
root. It accepts command symlinks but stores their canonical executable targets;
private data paths reject symlink ancestors. It stores only a protected
credential file reference, inventories the installed dependency tree, pins the
global tunnel-client state root without owning it, and delegates process
supervision to `tunnel-client runtimes`. Its private profile directory admits
only the fixed managed YAML. The fixed alias/profile is
`zotero-study-save-mcp`. See
[installation](../../docs/install.md) and [removal](../../docs/uninstall.md) for
operator commands and ownership boundaries.
