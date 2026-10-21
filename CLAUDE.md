# Zotero AI Research Companion

A macOS Zotero extension connects ChatGPT Web study conversations to native passage-linked annotations. Questions, long proofs, explanations, and references remain in the paper reader. This is a local installable product with replaceable file clients, not a hosted model service.

## Project structure

```text
.
├── AGENTS.md                         → agent entry and critical boundaries
├── CLAUDE.md                         → identical entry for Claude
├── docs/
│   ├── architecture.md               → components and request flow
│   ├── business-rules.md             → study-record behavior and consistency
│   ├── security.md                   → directory trust, authority, private history
│   ├── standards.md                  → enforced engineering and verification rules
│   ├── engineering-notes.md          → native runtime traps and diagnosis
│   ├── operations.md                 → reproducible build and local lifecycle
│   ├── contracts.md                  → complete consumer file protocol
│   └── tracking/
│       ├── status.md                 → verified capability and remaining work
│       ├── findings.md               → unresolved external limitations
│       └── decisions/
│           ├── index.md              → consequential decision catalog
│           ├── 0001-native-file-bridge.md → native persistence and file transport trade-off
│           └── 0002-reader-rendering.md  → portable source and permissive rendering dependencies
├── addon/
│   └── AGENTS.md                     → host bootstrap and extension identity
├── src/
│   ├── core/AGENTS.md                → immutable operations and coordination
│   ├── ports/AGENTS.md               → replaceable boundary interfaces
│   ├── protocol/AGENTS.md            → strict versioned JSON validation
│   ├── plugin/AGENTS.md              → composition and resource lifecycle
│   └── adapters/
│       ├── anchors/AGENTS.md          → evidence-based page geometry
│       ├── file-bridge/AGENTS.md      → local files and session ownership
│       ├── operation-store/AGENTS.md  → durable identity and recovery
│       ├── reader/AGENTS.md           → preview ownership and actual visibility
│       ├── rendering/AGENTS.md        → bounded safe Markdown and mathematics
│       ├── settings/AGENTS.md         → local setup and disable semantics
│       └── zotero/AGENTS.md           → guarded native data access
├── integration/AGENTS.md             → client instructions and surface-specific evidence
└── scripts/AGENTS.md                 → deterministic package and artifact validation
```

## Hard gates

- Study records remain native Zotero data; do not write SQLite or annotate by changing PDF bytes.
- A write requires the user's specified save or approval, current target evidence, and conflict protection.
- Long comments stay beside their passage; length never triggers a separate note or silent truncation.
- Operation identities survive ordinary reinstall; uncertain outcomes are reconciled before any retry.
- Treat paper and comment content as untrusted display data; no script execution or automatic remote resources.

## Before changing code

Read `docs/standards.md`, `docs/engineering-notes.md`, and the relevant module entry. Before changing consent or directory access, read the trust and failure paths in `docs/security.md`. Before changing lifecycle or persistence, read operation outcomes in `docs/business-rules.md`. Before changing schemas or client examples, read `docs/contracts.md` and check both distributed client artifacts. Before changing native display, plan an actual Zotero reader check with a deliberately owned PDF.

## Critical failures

Stop affected writes and report immediately if content crosses profiles, an unapproved mutation executes, a manual edit is overwritten, a retry duplicates native content, PDF bytes change, or credentials enter an artifact/log. Preserve minimal private diagnostic evidence without repeating the mutation. Record other unresolved defects and external limitations in `docs/tracking/findings.md`.

All project documents are English; user-facing discussion and saved study text follow the user's language.
