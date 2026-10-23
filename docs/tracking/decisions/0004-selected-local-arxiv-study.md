# Selected local arXiv study

## Context

The import-first conversation workflow depended on remote arXiv acquisition and inconsistent automatic plugin selection. The accepted product flow starts from a paper and PDF that the researcher has already saved in Zotero. The researcher explicitly selects Zotero Study Save in ChatGPT Web, supplies one official arXiv URL, studies the actual local PDF, and may later save discussion without repeating the URL, page, passage, or native keys when the target remains clear in the accessible conversation.

## Decision

Make the selected local-PDF flow the active ChatGPT workflow. `find_local_arxiv` performs offline discovery across all eligible Zotero libraries, preserving conflicting and unknown identity evidence. A fresh `read_pdf` establishes the actual attachment and fingerprint before the workflow treats a paper as the study target. Selection and study are read-only. Only a later explicit save instruction or acceptance of an exact proposal authorizes a native annotation or requested note mutation.

When the item or PDF is absent, metadata-only, unreadable, ambiguous, truncated, or inconsistent with an explicitly requested version, ask the researcher to add or repair it manually and wait. An attachment without a current fingerprint has inaccessible or unverified bytes; stop before `read_pdf` and ask for manual file or path restoration. Resume only when fresh discovery returns a current fingerprint, followed by fresh PDF reading. Do not invoke `inspect_arxiv`, `ensure_arxiv_pdf`, a downloader, or another acquisition route in this workflow. Those operations and their historical outcomes remain in protocol v1 for existing clients and journals.

Keep the established target only in accessible conversation context. A failed paper switch suspends the prior implicit destination; it does not send a later save back to the old paper. Preserve complete approved content in one passage-linked native comment or reject before mutation. Current fingerprints, revisions, operation identities, conflict checks, and separate storage/viewer evidence continue to govern writes and recovery.

## Alternatives

Continuing to import on save would make a study-record request authorize a separate acquisition and native-item mutation. Using a Web abstract or parent metadata as the studied paper would not prove that the local PDF was read. Requiring the URL, page, passage, and native keys again on every later save would discard the established conversation target. Depending on automatic plugin activation would make an inconsistent platform behavior a release gate even though explicit selection is available.

## Consequences

Release acceptance must observe explicit plugin selection, read-only local discovery, an actual local PDF read, and a later authorized passage-linked save on the current 0.3.0 installation. Automatic activation remains an optional convenience and is not a completion criterion. Missing papers and PDFs require user action in Zotero. Portable packages keep only null personal configuration and contain no profile, session, history, credentials, or private roots. Public distribution, a public Mac Safe Files installer, and independent ChatGPT Work validation remain separate decisions.
