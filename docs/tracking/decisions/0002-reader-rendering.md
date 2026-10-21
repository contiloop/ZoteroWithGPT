# Native source with sanitized reader rendering

## Context

Long proofs and Korean explanations must remain in the paper tab. Existing annotation-rendering plugins demonstrate the approach, but the evaluated current plugin code has AGPL obligations that were not adopted for this project's distribution.

## Decision

Keep editable Markdown and LaTeX in ordinary native annotation comments. Render a disposable local preview with pinned markdown-it, KaTeX, and DOMPurify dependencies and their bundled licenses. Use bounded parsing and semantic MathML checks, with readable fallback when rendering is unavailable.

## Alternatives

Moving long content to item notes would change the requested study experience. Flattening rendered content would lose editable source. Copying the evaluated AGPL plugin would impose an unapproved distribution trade-off. A handwritten math engine would duplicate established functionality and add correctness risk.

## Consequences

Uninstall leaves native text and mathematical notation readable, though formatted presentation requires the extension. Preview lifecycle and exact current-content visibility need real Zotero tests. Links open only after validation and user action; external resources do not load automatically. Dependency updates require renewed semantic, security, license, and native-host checks.
