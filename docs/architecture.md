# Architecture

ChatGPT Web supplies analysis and the user's save intent. Mac Safe Files carries
JSON through a dedicated local directory. The Zotero extension reads the chosen
PDF and commits native annotations; it exposes no network listener.

The core depends on ports; plugin composition binds Zotero, Gecko filesystem,
geometry, persistence, and rendering adapters. Transport replacement must not
change save authority, target identity, or retry semantics.

## Pipeline

1. Discover the manually saved paper by arXiv identity and read its local PDF.
2. Keep the chosen attachment in accessible conversation context.
3. On a save request, prepare only the requested content and resolve its passage.
4. Recheck authority, PDF fingerprint, and revision; commit native Zotero data.
5. Read back the saved body and return its deep link. Reader visibility is
   independent evidence and never a reason to repeat the write.

The journal survives reinstall to prevent duplicate execution. Old arXiv import
schemas and read-only reconciliation remain solely to interpret pre-cut history;
new acquisition operations are unsupported. PDF bytes and SQLite are never
modified by annotation saves. Native comments are canonical; sanitized formatted
previews are disposable and preserve editable Markdown/LaTeX source.
