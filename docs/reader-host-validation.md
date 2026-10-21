# Reader host validation

Observed on 2026-10-21 in Zotero 10.0.6 on macOS. This is bounded native-host evidence, not ChatGPT Web acceptance or a release installation result.

## Build and fixture

The normal Zotero Plugins Manager installed development build `0.1.0.5`. Its installed XPI and the assembled artifact both had SHA-256 `5fa97c618c84efb37b9e37f108e53f08796868408dc02dfc8ef2a5cc2ebac4fc`. The renderer and reader sources were frozen at `55dc57730a4809f72be13287758b776d6d9023c3`. The plugin reported ready on the real host. This developer assembly uses an explicitly disclosed fixture bridge and is not the distributable package recipe.

Only the owned fixture attachment `XI9DWNHS` and its highlight `986UN7S4` were modified. The highlight remained anchored to “Proof context: s(i) = R(e, s(i-1)).” on page 1. No existing research paper was changed. Fixture creation and other native-operation evidence are recorded in [native-host-validation.md](native-host-validation.md).

## Observed behavior

- A long Korean question, interpretation, conditional proof, and reference remained in one native annotation comment. No item-note conversion occurred.
- The reader sidebar displayed the highlighted source passage, Korean paragraphs, inline and display mathematics, and numbered induction steps. A host stylesheet initially clipped list markers; the final build visibly displayed `1.`, `2.`, and `3.` with paragraph spacing.
- The native editor was opened through **Edit native comment**. A manual Korean sentence and bracket-delimited formula were added using the actual Zotero editor, then **Show formatted comment** displayed the edit. A fresh native read returned both the earlier manual edit and this new sentence. This edit/refresh check ran on development build `0.1.0.4`, using the same reader integration commit included in `0.1.0.5`.
- After updating to `0.1.0.5`, the saved manual edits remained. Appending a cancellation expression and a two-line aligned derivation refreshed the existing preview. A real screenshot showed the cancellation stroke and aligned equals signs. Scrolling the sidebar exposed the end of the long comment while the source highlight remained visible in the PDF.
- Clicking the formatted reference opened **Mathematical induction — Wikipedia** in the default Safari browser. Its address field showed the exact approved HTTPS destination. The test-created browser tab was closed afterward. Loading the annotation itself did not require opening that reference.
- Native readback and a separate `verify_annotation` request both succeeded. Operation `reader-final-visible-1` returned storage `confirmed` and viewer `confirmed`, specifically for the current formatted comment. Targeted host diagnostics found MathML, the expected reference links, and zero resource-sink elements in the preview. This DOM check is narrower than a network capture.

## Source checks and remaining gates

The integrated `npm run verify` passed with 97 tests, type checking, and build checks. An independent reviewer also ran the 20 renderer/reader tests and approved the final source revision. Those tests cover malicious markup, resource sinks, invalid protocols, native fallback, reader refresh, owning-frame visibility, and complete readable fallback for 512 KiB malformed math input.

The native viewer fallback requires its own exact owning-reader visibility guard; a hidden native reader must not override a failed formatted-preview visibility check. That follow-up and its actual-host check are separate from the renderer approval above. Reproducible distribution, removal/reinstall, real-paper study, and a ChatGPT Web-origin request remain subsequent acceptance gates. The development bridge results must not be described as proof of those routes.
