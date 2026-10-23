# Build and local lifecycle

Use Node.js 24–26 and npm 11.4.2. From a fresh checkout run `npm ci`, then
`npm run verify`. Packaging generates an XPI, client folder, and portable plugin
ZIP with the same version. Never distribute a configured account export.

Settings are `extensions.zotero-ai-research-companion.enabled` and
`extensions.zotero-ai-research-companion.bridgeDirectory`; no environment
variable or API key is needed. Installation and removal belong to
[install](install.md) and [uninstall](uninstall.md).

Keep `<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json` through
ordinary reinstall. It contains private study text and historical identities,
not a disposable cache. New sessions do not authorize replaying pending writes.

For native acceptance use an owned PDF, an explicitly selected Web plugin,
a local PDF read, and a requested save with fresh native readback and actual
reader observation. Verify only the behavior changed; do not generate entire
proof conversations to test whether arbitrary discussion can be copied exactly.
A model preparation check and a native persistence check answer different
questions. Evidence from local Codex files cannot establish ChatGPT Work access.

The manifest's reserved `.invalid` update URL satisfies Zotero's install
requirement without creating an updater. Distribution remains manual; a public
release channel and project license remain separate decisions.
