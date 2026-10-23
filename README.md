# Zotero AI Research Companion

A local connection for studying PDFs already saved in Zotero and recording approved ChatGPT discussion as native passage-linked annotations. Long explanations, proofs, questions, and references belong beside their source passage in the paper reader.

## Development

Requires Node.js 24–26 and the declared npm 11.4.2 package manager. Recreate dependencies with `npm ci`, then run `npm run verify`.

The verification command covers strict TypeScript checking, the Node.js test suite, compilation, deterministic XPI packaging, and package validation. Real ChatGPT Web and Zotero reader acceptance remain separate checks; passing this command alone does not establish a working end-to-end connection. ChatGPT Work access has not been independently verified; direct Codex local files are the validated alternative route for this cycle.

Build the installable XPI, matching client instructions, and portable private-plugin source with `npm run package`. Version 0.3.0 adds the fifteenth protocol operation, the offline `find_local_arxiv` read. See [installation](docs/install.md), [removal and recovery](docs/uninstall.md), and [connection validation](docs/connection-validation.md).

No OpenAI API key is required. Do not put personal credentials, Zotero libraries, transport secrets, or private study content in this repository.

## Local study workflow

The researcher manually saves the paper and PDF in Zotero, explicitly selects **Zotero Study Save** in ChatGPT Web, and supplies one official arXiv URL. The plugin finds candidates offline across eligible libraries and reads the actual local PDF. Study is read-only. A later explicit save can use the established conversation target without asking again for the URL, page, passage, or native keys; current fingerprint, anchor, revision, and conflict checks still apply.

Missing, metadata-only, unreadable, ambiguous, truncated, or version-conflicting candidates require a focused choice or manual Zotero action followed by fresh discovery and PDF reading. An attachment without a current fingerprint stops before `read_pdf`; the researcher restores its path or access manually, and the plugin performs fresh discovery rather than invoking a read as repair. This workflow never invokes the retained remote import operations. Automatic plugin invocation is optional and is not a 0.3.0 completion gate.

Actual 0.3.0 acceptance on macOS Zotero 10.0.6 verified two explicitly selected ChatGPT Web conversations, offline local-PDF study, contextual passage-linked saves, full long-body preservation, manual-add recovery, native reader visibility, manual-edit conflict protection, ordinary component removal/reinstall, and historical replay without duplication. Direct Codex local files remain a verified alternate client. One initial read request stalled; its cause remains unresolved, and reader timeout/recovery wording improvements remain open. A public Mac Safe Files installer and independent ChatGPT Work execution are not supplied or claimed. Distribution remains local and manual; no public release has been published.
