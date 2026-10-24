# Troubleshooting

| Symptom | Action |
| --- | --- |
| Settings menu missing | Check the extension in Tools → Plugins and restart after installation. Reinstall uses remove/restart/install/restart. |
| Update service unavailable | Expected: packages are installed manually; the reserved `.invalid` URL is not an updater. |
| Disabled or Enable error | Select an existing dedicated root, enable explicitly, and check permissions. Directory selection alone does not enable processing. |
| Server dependency install fails | Confirm Node.js 24–26 and npm 11.4.2, extract a fresh server ZIP, and run the included production lock command. Do not reuse a worktree or symlinked `node_modules`. |
| Lifecycle install rejects an executable | The path may be a symlink, but its canonical target must be a regular executable. Check the independent Node and reviewed tunnel-client target separately from bridge/credential permissions. |
| Lifecycle install rejects the credential | Supply an existing `file:` reference to a regular non-symlink file with no group/other permissions. Never paste the key itself. |
| ChatGPT cannot connect | Require owned runtime status `processRunning`, `healthy`, and `ready`; confirm the private account plugin uses the verified dedicated MCP app binding; keep Zotero enabled and running. The portable ZIP alone is unconfigured. |
| Version mismatch | Update all four portable artifacts together, then build the private account archive from the current guarded account manifests. |
| Remove refuses the runtime root | Preserve the tree. An unknown file, copied marker, symlink, or root mismatch failed the ownership fence; inspect it locally instead of forcing recursive deletion. |
| Account overlay retains old resources | Apply each exact file in the helper's `deletePaths`; a directory prefix is not an exact delete path. |
| Rollback does not reconnect | Expected: runtime rollback restores the previous route and leaves it stopped. Inspect it, then start explicitly. Account routing rollback has a separate newer-version requirement. |
| Paper missing, PDF absent, or fingerprint unavailable | Save/restore the PDF manually in Zotero, then request fresh discovery. Do not use an import fallback. |
| Several candidates | Choose by title/version/attachment. An unversioned link does not select the latest version. |
| No result file | Check current descriptor/status/descriptor. Missing output does not prove the write did not run; keep its original identity. |
| Conflict | Read the current annotation and resolve the changed edit. Do not overwrite a manual edit using an old revision. |
| Too large or unrepresentable text | Review the requested scope or exact body; do not silently truncate, split, or create overflow notes. |
| Saved but reader check failed | Open the returned Zotero link and inspect the comment. Do not repeat the save. A normal restart may clear stale reader wrappers. |
| Reader request remains running | Stop new requests and preserve its ID. See the unresolved reader-acquisition finding; another quick item query does not establish reader readiness. |
| Unknown outcome | Preserve the original operation and report uncertainty; never substitute a new write ID. |

Request/result files and the journal contain private study text. Redact them
before sharing diagnostics. Lifecycle errors omit command stdout/stderr so a
tunnel ID, credential path, or key cannot be copied into a public log.
[Removal](uninstall.md) retains bridge sessions, native study data, and
duplicate protection.
