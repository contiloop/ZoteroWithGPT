# Troubleshooting

| Symptom | Action |
| --- | --- |
| Settings menu missing | Check the extension in Tools → Plugins and restart after installation. Reinstall uses remove/restart/install/restart. |
| Update service unavailable | Expected: packages are installed manually; the reserved `.invalid` URL is not an updater. |
| Disabled or Enable error | Select an existing dedicated root, enable explicitly, and check permissions. Directory selection alone does not enable processing. |
| ChatGPT cannot connect | Select Zotero Study Save, check its private `bridgeRoot` and Mac Safe Files access, and keep Zotero running. |
| Version mismatch | Update XPI, client kit, and personal plugin together. |
| Paper missing, PDF absent, or fingerprint unavailable | Save/restore the PDF manually in Zotero, then request fresh discovery. Do not use an import fallback. |
| Several candidates | Choose by title/version/attachment. An unversioned link does not select the latest version. |
| No result file | Check current descriptor/status/descriptor. Missing output does not prove the write did not run; keep its original identity. |
| Conflict | Read the current annotation and resolve the changed edit. Do not overwrite a manual edit using an old revision. |
| Too large or unrepresentable text | Review the requested scope or exact body; do not silently truncate, split, or create overflow notes. |
| Saved but reader check failed | Open the returned Zotero link and inspect the comment. Do not repeat the save. A normal restart may clear stale reader wrappers. |
| Reader request remains running | Stop new requests and preserve its ID. See the unresolved reader-acquisition finding; another quick item query does not establish reader readiness. |
| Unknown outcome | Preserve the original operation and report uncertainty; never substitute a new write ID. |

Request/result files and the journal contain private study text. Redact them
before sharing diagnostics. [Removal](uninstall.md) retains native study data
and duplicate protection.
