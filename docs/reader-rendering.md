# Reader rendering decisions

Native Zotero comments are the canonical editable Markdown/LaTeX source.
Formatted preview nodes are disposable. The reader defaults to preview with an
explicit native-edit switch so long comments are not displayed twice.

KaTeX emits MathML to avoid remote fonts/styles. Unsupported or over-budget
math stays readable as source without changing native data. Sanitization must
preserve semantic cancellation/alignment while rejecting resource loading.
Links open only after a click. Long prose remains fully accessible; wide math
may scroll horizontally.

Zotero's annotation state supplies canonical content because hidden editor
`innerText` depends on layout. Reader wrappers can outlive their windows;
isolate dead unrelated wrappers rather than aborting healthy synchronization.
These semi-internal reader surfaces require actual host checks after upgrades.

Visible preview evidence needs the exact attachment/annotation, current fresh
content, an active owning reader, and a laid-out body in the viewport. Neither
a background tab, deep link, toolbar, nor stored JSON proves display.

The renderer/lifecycle split was informed by the MIT-licensed v0.15.4 design of
[qrkks/zotero-annotation-markdown](https://github.com/qrkks/zotero-annotation-markdown/tree/f899572eae3214df5096ca5356803b4e1872ee4c).
No source was copied; later AGPL releases were not adopted. Dependency license
choices remain in `src/adapters/rendering/THIRD_PARTY_NOTICES.md` and the bundled
notices. Versions and exact limits are defined by code/lockfile, not repeated here.
