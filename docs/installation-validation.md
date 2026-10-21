# Installation and recovery validation

Validated on 2026-10-21 in Zotero 10.0.6 on macOS arm64. These observations concern the production package, separately from the earlier development probe.

## Package and clean rebuild

Source revision: `d77043e523cf9109c17fbc51851f28d620ac5c7f`.

The versioned `0.1.0` XPI has SHA-256 `14be160836366dcc9e28defbbe86b1c1d490b6269699c80b457fcd30c169d16c`. Its matching client kit contains 13 files; the XPI contains 28 files, including notices and nine license files for eight bundled runtime packages.

A fresh `git archive` extraction had no existing dependencies or generated files. `npm ci` and `npm run verify` both exited 0; all 135 tests passed. The clean build produced the same XPI SHA-256 as the installed artifact. The temporary extraction was removed after comparison. The package requires the declared Node.js/npm build environment; it does not require the developer's Zotero profile to build.

## Actual installation and setup

The first production XPI was rejected. Inspection of the installed `modules/Extension.sys.mjs` showed that Zotero requires a truthy `applications.zotero.update_url`. The corrected package declares the reserved no-service URL described in the installation guide. This is a manual distribution policy, not a hosted updater.

Zotero's Plugins Manager accepted the corrected artifact and displayed **Zotero AI Research Companion 0.1.0**, enabled. Its Tools settings dialog initially showed **Disabled**, with no directory selected. Selecting a dedicated test bridge and explicitly choosing **Enable** produced **Ready** and a new session. A direct Codex file-protocol `connection_status` returned plugin version `0.1.0`, Zotero version `10.0.6`, the expected profile, and `enabled: true`.

## Disable, remove, reinstall, and retry

The owned native fixture has parent item `5JYKRIIT`, PDF attachment `XI9DWNHS`, and annotation `986UN7S4` in library `1`.

1. Chose **Disable** in the settings dialog. The published session status changed to `enabled: false`.
2. Deliberately published an owned test mutation into that disabled session. No result was produced and no native note appeared. This intentionally invalid test publication bypassed the normal client's enabled-session guard; ordinary clients must stop at that guard.
3. Removed only Research Companion through Plugins Manager and confirmed its absence. In the actual PDF reader, the long Korean comment, multiline proof, question, manual edits, and reference remained readable and editable as a native annotation. Without the extension, mathematical source notation remained available in Zotero's ordinary comment editor.
4. Reinstalled the exact same versioned XPI. The selected directory and **Disabled** state remained. Reinstallation did not execute the pending request or silently enable the connection.
5. Explicitly chose **Enable**. Session `0bc3a12e71fa4770172af7e8e5faae4c` was replaced by `639bce80c4f3e258f081804c2af45eae`. The old pending request remained unprocessed and its test note was absent from a fresh native note listing.
6. Replayed the exact previously successful operation `native-mcp-proof-highlight-1` with its original payload and authorization. It returned success and the original key `986UN7S4`. A fresh annotation listing contained exactly that one annotation, with the original current revision and complete comment. Historical retry did not duplicate it.
7. Returned to the actual fixture reader after reinstallation. Formatted comment display and the native-edit control were available again.

The fixture PDF SHA-256 remained `c2fbe4c5d2d2a372492278542b9aa4008dbf8407f8bc54335a3aaf30b990e336`. Shared MCP settings and unrelated Zotero plugins were not changed. The operation journal was retained as documented. No permanent deletion or Trash purge was performed.

Actual ChatGPT Web study-session acceptance is a separate test; these installation results alone do not establish it.

## Final source follow-up — 2026-10-22

The integrated safety build at source `852e6af` passed 158 tests and a fresh dependency installation/build reproduced installed XPI SHA-256 `49b21211352f90846c34a2e029e8f5f554523c91a35380f8c421dce70882ee54`. Actual note preservation and aggregate-size checks passed on that installed artifact. A reproduced stale unrelated reader was subsequently isolated; source `97d75df950c8ad3fcb0b31867c0e2a6bef575c2a` passed all 160 tests, type checking, build, and package checks. Its XPI SHA-256 is `01975e560f477ac024d23ed29cd5a4c1da1bd9bd4ad61ac256901158e29cf152`. Normal Plugins Manager update accepted that artifact, its installed hash matched, and native storage plus strict formatted-reader verification passed without a restart. The connection now uses a dedicated ignored `.local/bridge` rather than a temporary test directory.

A fresh source extraction at `5675e2b` subsequently ran `npm ci` and `npm run verify`, both exit 0 with 160 tests, and reproduced that exact final installed XPI hash. No existing dependency tree, developer Zotero profile, or generated build artifact was present in the extraction.
