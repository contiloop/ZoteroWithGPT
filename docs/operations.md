# Build and local operation

## Recreate the build

Use macOS for native validation, Node.js 24, 25, or 26, and the declared npm 11.4.2 package manager for building. From a clean checkout, run these in order:

```sh
npm ci
npm run verify
```

The installable results are `artifacts/zotero-ai-research-companion-0.3.1.xpi`, its matching `-client` directory of plain-text instructions/schemas/examples, and `artifacts/zotero-study-save-0.3.1.zip`. `npm run package` regenerates all three after source or bundled-document changes. Compare SHA-256 values before calling a clean build identical to the installed package.

## Install and connect

1. In Zotero 10.0.6 through 10.0.x, open Tools → Plugins → gear → Install Plugin From File and select the versioned XPI.
2. Create one dedicated existing local directory. Do not select the whole Desktop, home, library data directory, or a shared/synced research directory.
3. Create `client-v1` inside it and copy the contents of the matching client folder there; verify `client-v1/README.md` exists.
4. Open Tools → Research Companion Settings, choose the dedicated root, review its absolute path, and enable it. Require Ready.
5. Give an already authorized file client that exact root. Have it follow the supplied client README, check descriptor/status/descriptor, and submit a fresh connection-status request.
6. Require matching protocol/profile and enabled status. Test a deliberately owned PDF before using real study records. Inspect storage and the actual paper reader separately.

For ChatGPT Web use, create or update the private personal **Zotero Study Save** plugin through the account's supported plugin flow using the matching ZIP. Retain its Mac Safe Files dependency. Set only `skills/zotero-study-save/resources/personal-config.json` → `bridgeRoot` in the private instance to the dedicated root. The portable ZIP keeps that value null. Manually save the paper and PDF in Zotero, begin a fresh chat, explicitly select Zotero Study Save, provide one official arXiv URL, and request read-only study. The root/path protocol belongs inside that installed workflow rather than a repeated user connection prompt. Installation and status alone do not establish local PDF reading or native save behavior.

Mac Safe Files is an existing independent connection; this repository has no public installer for it. Use its owner's setup procedure rather than copying another user's secrets. Direct Codex local files are validated as an alternative. Work requires its own actual local-access check; no automatic transfer or usage price is promised.

Configuration consists of the selected directory and `extensions.zotero-ai-research-companion.enabled` / `extensions.zotero-ai-research-companion.bridgeDirectory` preferences. The plugin requires no environment variable, Zotero API key, or OpenAI API key. Zotero must be running for request processing.

## Update, disable, and remove

Obtain matching XPI and client kit versions, update through Plugins Manager, replace the copied client kit, and start from the new descriptor. If reader checks encounter a dead-window error after update, normally quit/reopen Zotero and run a fresh read-only verification; do not repeat a successful save.

Update the existing owned personal ChatGPT plugin using the matching portable source at a strictly greater semantic version. Preserve its identity, account defaults, and Mac Safe Files dependency; restore only the private bridge-root setting if needed. Read back the installed version/resources and begin a fresh explicitly selected chat. Account-generated compatibility manifests and author metadata can differ from the portable source; inspect that difference without distributing account identity or private configuration.

Disable in Research Companion Settings before changing directories or removing the extension. Confirm disabled status, then remove only Research Companion in Plugins Manager. Native comments and notes remain ordinary Zotero data.

Retain `<ZOTERO_PROFILE>/zotero-ai-research-companion/operations-v1.json` through reinstall. It contains private historical results and duplicate-prevention identities. Losing it can remove historical retry protection; deleting it is not routine cleanup.

After disable/removal, inspect the dedicated root and move only owned `bridge-v1.json`, `sessions`, and copied `client-v1` to Trash if requested. Leave unrecognized files and shared MCP/tunnel installations intact. Reset only the two named preferences if a clean local setup is requested. Reinstall, explicitly enable, and use the new descriptor without automatically copying old pending files.

Distribution is manual. The manifest's reserved .invalid update URL supplies no update service. Public release channels and the project's own distribution license remain decisions before public publication.

Remove the owned personal **Zotero Study Save** plugin through ChatGPT management separately from the XPI. Leave Mac Safe Files and unrelated plugins connected. Reinstall using the portable source and restore the one private root setting; never embed an old descriptor, pending operation, or result. Both ordinary component removal procedures retain native study data and the Zotero operation journal. Actual lifecycle acceptance remains surface/version specific.

The observed personal-plugin lifecycle used the detail page's **Uninstall** action, not **Delete plugin**. The owned backend and release history remained available, and the same page exposed **Install plugin**. After installation, verify all of the following before use: the expected version, **Use Zotero Study Save** checked, Mac Safe Files connected, unchanged owned backend/current release, the expected account file inventory, and exactly the private `bridgeRoot` customization. Both the historical 0.2.2 run and the current 0.3.0 run restored those values without creating a release during reinstall or deleting the owned backend. The current 0.3.0 private account update and subsequent ordinary lifecycle checks passed.

## 0.3.0 selected-workflow acceptance

Use a deliberately owned PDF and preserve existing native records and operation history. Acceptance for 0.3.0 requires all of these observations on the actual current installation:

1. The installed profile XPI hash matches the reviewed 0.3.0 artifact. A fresh `connection_status` reports plugin 0.3.0, the intended profile, enabled state, and all 15 operations including `find_local_arxiv`.
2. The matching private plugin is updated in place, keeps its existing identity/account defaults and Mac Safe Files binding, contains only the one private `bridgeRoot` customization, and is explicitly selected in a fresh Web conversation.
3. The first study turn supplies one official arXiv URL and produces only read operations: `connection_status`, fresh `find_local_arxiv`, and fresh `read_pdf`. Confirm the actual local attachment and fingerprint. No `inspect_arxiv`, `ensure_arxiv_pdf`, downloader, import, annotation, or note request may appear.
4. A later explicit save in the same accessible conversation uses the established target without requiring the URL, page, quote, or native keys again. It refreshes target evidence, resolves a current passage, saves the complete approved body in one passage-linked native comment, and reports storage and actual reader visibility separately.
5. Fresh native reads prove the exact complete comment, current anchor fingerprint, one intended record, no overflow note, and no duplicate operation. A deliberate manual-edit conflict preserves the current body. Missing/metadata-only and failed-switch cases produce no mutation and resume only after fresh local lookup and PDF reading. A lookup result without a current fingerprint produces no `read_pdf` or repair request and resumes only after manual restoration plus fresh discovery returns a fingerprint.
6. Normal Zotero removal/reinstall retains native records and the journal. ChatGPT **Uninstall** and **Delete plugin** remain distinct; do not delete the owned backend during the lifecycle check.

Automatic plugin invocation is not a 0.3.0 completion gate. It may remain eligible for a later save when context is clear, but acceptance starts with visible explicit selection. Direct Codex local-file verification remains a separate proven route and cannot establish the Web observation. The actual 0.3.0 installation established Web, native mutation, reader, and ordinary lifecycle observations on 2026-10-23, but independent final review found empirical content omitted before writing, so complete-content acceptance failed. Version 0.3.1 requires fresh corrected-client acceptance. Two fresh selected conversations established independent local targets; missing and metadata-only targets stopped, and an owned manual PDF addition was discovered and read afresh. Direct-local append and stale-edit checks separately preserved the complete body. Package verification alone must never be substituted for those actual observations.

## Observed Zotero reinstall ordering

Actual 0.2.2 and 0.3.0 acceptance established this reliable sequence:

1. Remove Research Companion in Plugins Manager.
2. Normally quit and reopen Zotero so removal completes.
3. Install the exact reviewed XPI through Plugins Manager.
4. Normally quit and reopen Zotero again.
5. Verify the installed profile XPI hash, copy the matching client kit, enable the bridge, and use a fresh descriptor/status/descriptor sequence.

Installing again in the same Zotero run before the removal-completing restart can appear enabled temporarily but fail to persist after restart. In the observed run, a request addressed to that unsatisfied session remained unprocessed. It was not moved, replayed under a new ID, or treated as proof of nonexecution. After the complete sequence, fresh status and native reads passed, the operation journal remained available, and byte-identical replay of a historical successful request returned history without duplicating the parent, PDF, or annotation.

## Temporary controlled-host diagnostics

Production packages must not add generic fault commands or evaluation surfaces. When a reviewed acceptance-only XPI is required, pin its source commit and archive hash, use fixed synthetic identities and a separate journal, run each fixed case once after confirming those identities are absent, and label exactly which boundary it controls. Preserve its terminal journal records; do not reidentify a failed or rejected case.

After evidence capture, remove the temporary add-on normally and confirm its Tools commands are gone. Move only its clearly labeled owned fixture to Zotero Trash when the runbook calls for cleanup; do not erase its diagnostic journal or touch user papers. Recheck the production XPI hash and run a fresh descriptor/status/descriptor operation. A synthetic embedded-byte attachment fault is not evidence of a network failure, and an isolated diagnostic gate is not evidence of a production-settings toggle.
