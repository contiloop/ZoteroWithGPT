# System architecture

ChatGPT Web supplies the conversation and study analysis. An already authenticated Mac file client carries bounded JSON into a user-selected directory. The Zotero extension consumes those files locally; it does not expose a network listener. A direct Codex local-file client uses the same entry point. Independent ChatGPT Work execution has not been established.

## Components and dependency direction

| Component | Responsibility and direction |
| --- | --- |
| Conversation client | Selects paper, requests reading, obtains save authority, publishes requests and reads results; never receives Zotero runtime objects |
| File bridge | Converts complete versioned files into operation submissions and publishes responses; depends on transport and execution interfaces |
| Operation coordinator | Validates and snapshots requests, claims immutable identity, serializes mutations, and records outcomes; depends on ports rather than Gecko or Zotero globals |
| Native library and anchor adapters | Translate typed requests into Zotero application access and PDF-reader geometry; return native keys and snapshots |
| Operation journal and recovery | Persist operation identities, results, and native reconciliation evidence within one Zotero profile |
| Reader and rendering adapters | Derive a sanitized Markdown/MathML preview from canonical native comments; inspect actual visible reader state |
| Settings and plugin composition | Bind native implementations, selected directory, connection lifecycle, and reader lifecycle |
| Package tooling | Bundles the extension and matching plain-text client kit; does not bundle a user's transport or profile |

The TypeScript core imports protocol definitions and abstract ports. Concrete Zotero, Gecko filesystem, DOM rendering, hashing, and persistence adapters implement those ports. Plugin composition owns concrete wiring. Replacing a transport therefore does not change the meaning of a study save.

## Representative save

The conversation client searches and reads a selected PDF, obtains a fingerprint and passage evidence, then resolves an anchor. After the user's save instruction or proposal approval, the client checks the active descriptor and enabled session, publishes one complete request, and polls its matching result.

The bridge validates file identity and scope before submission. The coordinator claims the operation and serializes its mutation. The native adapter revalidates the current PDF, anchor, and target state, commits ordinary Zotero data, and reads it back. The journal records the result before transport publication. A later verification request inspects storage and the active reader independently.

Only metadata, bounded extracted text, geometry candidates, and JSON results cross the file boundary. PDF binaries, credentials, executable code, and arbitrary filesystem commands do not. Native annotations and optional notes remain in Zotero; preview nodes are disposable. Zotero remains responsible for ordinary library sync.
