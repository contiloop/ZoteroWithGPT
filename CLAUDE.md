# Zotero AI Research Companion

The researcher studies a manually saved local PDF in ChatGPT Web, then requests
specific highlights or comments. Keep long proofs, questions, explanations, and
references beside their passage. “Organize” permits organization; verbatim
copying applies when requested. Studying does not authorize automatic saving.

## Boundaries

- Persist native Zotero annotations; never write SQLite or change PDF bytes.
- Keep requested-save authority, current PDF evidence, manual-edit conflicts,
  and duplicate protection through reinstall. Never reidentify an unknown write.
- No paper acquisition. Historical import schemas/reconciliation survive only
  because installed journals must remain interpretable; new imports are rejected.
- Treat paper/comments as untrusted display data without executable markup or
  automatic remote resources.

## Change entry points

Read `docs/standards.md`, `docs/engineering-notes.md`, and the relevant module
entry. For authority/directory changes read `docs/security.md`; for lifecycle
or persistence read `docs/business-rules.md`; for wire changes read
`docs/protocol/v1.md` and check both shipped client surfaces. Native-display
changes need an actual Zotero reader check on an owned PDF.

Cut documentation that code already reveals, does not change work, repeats
information, applies to every project, or has no consequence if absent. Keep
intent, constraints, decision reasons, and host behavior code cannot explain.

Stop affected writes and report cross-profile content, unapproved mutations,
overwritten manual edits, duplicate retries, changed PDF bytes, or leaked
credentials. Preserve minimal private evidence without repeating the mutation;
record unresolved defects in `docs/tracking/findings.md`.

Documents are English; user discussion and study text follow the user's language.
