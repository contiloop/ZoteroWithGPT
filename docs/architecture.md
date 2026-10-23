# System architecture

ChatGPT Web supplies the conversation and study analysis. An already authenticated Mac file client carries bounded JSON into a user-selected directory. The Zotero extension consumes those files locally; it does not expose a network listener. A direct Codex local-file client uses the same entry point. Independent ChatGPT Work execution has not been established.

## Components and dependency direction

| Component | Responsibility and direction |
| --- | --- |
| Conversation client | Selects paper, requests reading, obtains save authority, publishes requests and reads results; never receives Zotero runtime objects |
| ChatGPT personal plugin | Packages save-intent instructions and the existing Mac Safe Files dependency; keeps only the bridge root in private instance configuration |
| File bridge | Converts complete versioned files into operation submissions and publishes responses; depends on transport and execution interfaces |
| Operation coordinator | Validates and snapshots requests, claims immutable identity, serializes mutations, and records outcomes; depends on ports rather than Gecko or Zotero globals |
| Native library and anchor adapters | Translate typed requests into Zotero application access and PDF-reader geometry; return native keys and snapshots |
| Local arXiv discovery | Parses one official URL locally, searches all eligible native libraries, preserves parent/PDF identity evidence, and returns candidates without network access or mutation |
| Legacy arXiv acquisition and native import | Retains protocol-v1 compatibility for existing clients and historical outcomes behind bounded source and native-import ports; it is outside the selected local-study workflow |
| Operation journal and recovery | Persist operation identities, results, and native reconciliation evidence within one Zotero profile |
| Reader and rendering adapters | Derive a sanitized Markdown/MathML preview from canonical native comments; inspect actual visible reader state |
| Settings and plugin composition | Bind native implementations, selected directory, connection lifecycle, and reader lifecycle |
| Package tooling | Bundles matching XPI, plain-text client kit, and portable ChatGPT plugin; does not bundle a user's transport, personal configuration, or profile |

The TypeScript core imports protocol definitions and abstract ports. Concrete Zotero, Gecko filesystem, DOM rendering, hashing, and persistence adapters implement those ports. Plugin composition owns concrete wiring. Replacing a transport therefore does not change the meaning of a study save.

## Representative save

The conversation client searches and reads a selected PDF, obtains a fingerprint and passage evidence, then resolves an anchor. After the user's save instruction or proposal approval, the client checks the active descriptor and enabled session, publishes one complete request, and polls its matching result.

The bridge validates file identity and scope before submission. The coordinator claims the operation and serializes its mutation. The native adapter revalidates the current PDF, anchor, and target state, commits ordinary Zotero data, and reads it back. The journal records the result before transport publication. A later verification request inspects storage and the active reader independently.

Only metadata, bounded extracted text, geometry candidates, and JSON results cross the file boundary. PDF binaries, credentials, executable code, and arbitrary filesystem commands do not. Native annotations and optional notes remain in Zotero; preview nodes are disposable. Zotero remains responsible for ordinary library sync.

## Studying a manually saved arXiv PDF

The researcher first saves the paper and PDF in Zotero, then explicitly selects the personal plugin in ChatGPT Web and supplies one official arXiv URL. The plugin checks the live file session, calls `find_local_arxiv`, resolves ambiguity from the returned evidence, and calls `read_pdf` on the chosen local attachment. No HTTP request, download, import, native record creation, or save approval occurs during this read-only start. A parent item or Web abstract cannot substitute for reading the attachment.

The accessible conversation retains the established profile, library, paper, attachment, fingerprint, and known or unknown version evidence. A later save can infer the same target without asking again for the URL, page, quote, or native keys. Before mutation it refreshes session and target evidence, resolves the passage, and applies the ordinary authorization, revision, fingerprint, conflict, and operation-identity gates. A failed explicit switch leaves no implicit fallback destination.

Missing, metadata-only, unreadable, ambiguous, truncated, or version-conflicting results return to the researcher for a focused choice or manual Zotero action. A selected attachment without a current fingerprint has unverified local bytes, so the workflow stops before `read_pdf`, waits for manual path or access restoration, and repeats fresh discovery before reading. `inspect_arxiv` and `ensure_arxiv_pdf` remain wired protocol-v1 operations for older clients and immutable history, but this workflow never calls them or another acquisition route.

Installation, explicit ChatGPT selection, local PDF reading, native persistence, and actual reader visibility are separate acceptance surfaces. Direct local requests prove the Codex route only. Automatic activation may remain eligible but is not a completion criterion for the selected workflow, and independent ChatGPT Work execution remains unverified.
