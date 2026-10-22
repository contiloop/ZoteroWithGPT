# Build and local operation

## Recreate the build

Use macOS for native validation and Node.js 24, 25, or 26 with npm for building. From a clean checkout, run these in order:

```sh
npm ci
npm run verify
```

The installable result is `artifacts/zotero-ai-research-companion-0.2.0.xpi`; its matching `-client` directory contains plain-text instructions, schemas, and examples. `npm run package` regenerates both after source or bundled-document changes. Compare SHA-256 values before calling a clean build identical to the installed package.

## Install and connect

1. In Zotero 10.0.6 through 10.0.x, open Tools → Plugins → gear → Install Plugin From File and select the versioned XPI.
2. Create one dedicated existing local directory. Do not select the whole Desktop, home, library data directory, or a shared/synced research directory.
3. Create `client-v1` inside it and copy the contents of the matching client folder there; verify `client-v1/README.md` exists.
4. Open Tools → Research Companion Settings, choose the dedicated root, review its absolute path, and enable it. Require Ready.
5. Give an already authorized file client that exact root. Have it follow the supplied client README, check descriptor/status/descriptor, and submit a fresh connection-status request.
6. Require matching protocol/profile and enabled status. Test a deliberately owned PDF before using real study records. Inspect storage and the actual paper reader separately.

Mac Safe Files is an existing independent connection; this repository has no public installer for it. Use its owner's setup procedure rather than copying another user's secrets. Direct Codex local files are validated as an alternative. Work requires its own actual local-access check; no automatic transfer or usage price is promised.

Configuration consists of the selected directory and `extensions.zotero-ai-research-companion.enabled` / `extensions.zotero-ai-research-companion.bridgeDirectory` preferences. The plugin requires no environment variable, Zotero API key, or OpenAI API key. Zotero must be running for request processing.

## Update, disable, and remove

Obtain matching XPI and client kit versions, update through Plugins Manager, replace the copied client kit, and start from the new descriptor. If reader checks encounter a dead-window error after update, normally quit/reopen Zotero and run a fresh read-only verification; do not repeat a successful save.

Disable in Research Companion Settings before changing directories or removing the extension. Confirm disabled status, then remove only Research Companion in Plugins Manager. Native comments and notes remain ordinary Zotero data.

Retain `<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json` through reinstall. It contains private historical results and duplicate-prevention identities. Losing it can remove historical retry protection; deleting it is not routine cleanup.

After disable/removal, inspect the dedicated root and move only owned `bridge-v1.json`, `sessions`, and copied `client-v1` to Trash if requested. Leave unrecognized files and shared MCP/tunnel installations intact. Reset only the two named preferences if a clean local setup is requested. Reinstall, explicitly enable, and use the new descriptor without automatically copying old pending files.

Distribution is manual. The manifest's reserved .invalid update URL supplies no update service. Public release channels and the project's own distribution license remain decisions before public publication.
