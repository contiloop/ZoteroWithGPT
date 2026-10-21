# Reader rendering

## Purpose and storage boundary

The reader adapter displays a formatted view of a native Zotero annotation comment beside its
passage. Zotero's annotation item remains the only canonical record. The adapter does not create a
parallel notebook, cache, database, or item note. Removing or stopping the adapter removes only its
DOM nodes and style; the native comment and Zotero's ordinary editor remain available.

In a selected annotation, the formatted view is shown by default. **Edit native comment** reveals
Zotero's existing editor, and **Show formatted comment** returns to the preview. This avoids showing
two full copies of a long explanation while retaining the native edit path. Links open only after an
explicit click through the callback supplied by the composition root.

## Supported content

The renderer supports ordinary Markdown paragraphs, headings, emphasis, lists, block quotes, code,
tables, and HTTP or HTTPS reference links. It supports these math delimiters:

- `$x^2$` for inline math
- `$$x^2$$` for display math, including a delimiter pair on separate lines
- `\(x^2\)` for inline math
- `\[x^2\]` for display math, including a delimiter pair on separate lines

Inline and fenced code stays literal. Invalid or unsupported TeX is displayed as its complete source
instead of being dropped. A failure of the Markdown engine falls back to escaped, line-preserving
plain content. Neither fallback changes the native annotation comment.

KaTeX emits MathML only. The adapter therefore does not fetch KaTeX fonts or a remote stylesheet.
Long prose is not line-clamped or vertically truncated. Wide preformatted text and display equations
can scroll horizontally inside the reader sidebar.

## Security boundary

All annotation content is untrusted. Rendering applies these boundaries in order:

1. Markdown-it runs with raw HTML disabled and no image element output.
2. KaTeX runs with `trust: false`, `strict: "error"`, `maxExpand: 1000`, `maxSize: 20`, and
   MathML-only output.
3. DOMPurify applies a final explicit HTML and MathML tag and attribute allowlist.
4. Resource-loading elements and attributes, SVG, event handlers, inline styles, `javascript:`,
   `data:`, `file:`, and unknown protocols are absent from the result.
5. Only absolute HTTP and HTTPS links remain actionable. The reader adapter prevents the iframe's
   default navigation and passes the URL to the explicit `openLink` callback.

The inserted stylesheet contains no imports, URLs, fonts, or other external-resource references.
Raw annotation HTML is displayed as text. Existing native Zotero rich-text behavior remains available
through the native editor.

## Integration API

`SafeMarkdownRenderer` implements `UntrustedContentRenderingPort`. It requires an explicit DOM
window for DOMPurify. `ZoteroReaderRenderingAdapter` requires the Zotero reader host, that rendering
port, and an explicit link-opening callback:

```ts
const renderer = new SafeMarkdownRenderer({ window: zoteroWindow });
const readerRendering = new ZoteroReaderRenderingAdapter({
  host: Zotero,
  renderer,
  openLink: (url) => Zotero.launchURL(url),
});

await readerRendering.start();
```

Call `refresh()` after a native annotation create or update. A reader-local mutation observer also
tracks ordinary native edits and React row replacement. A bounded scan attaches newly opened readers
and detaches closed or reloaded reader documents. Call `stop()` when access is disabled or the plugin
shuts down. Stop and render-error cleanup remove all adapter-owned previews, styles, listeners, and
mode attributes.

The adapter uses the Zotero 10 reader surfaces observed in the shipped application:
`Zotero.Reader._readers`, `reader.itemID`, `reader._initPromise`,
`reader._internalReader._state`, `reader._iframeWindow.document`,
`[data-sidebar-annotation-id]`, and `.annotation-popup .comment .content`. These are semi-internal
interfaces and must be acceptance-tested again after a Zotero upgrade. They are runtime inputs, not
machine-specific build state.

## Visible-preview evidence

The composition root can verify formatted display with:

```ts
await readerRendering.verifyVisiblePreview({
  attachmentItemId,
  annotationKey,
  expectedNativeComment,
});
```

`expectedNativeComment` must come from a fresh native Zotero read. The method returns true only when
all of the following hold:

- an open reader has the exact numeric attachment item ID;
- the exact annotation row is in the open annotations sidebar, or the exact annotation is the sole
  selection represented by the popup;
- the formatted preview is connected, laid out, and intersects the visible reader viewport after
  ancestor clipping;
- the visible formatted body equals a fresh safe rendering of the expected native comment; and
- the preview is in formatted mode rather than native-source editing mode.

It checks every open reader for the attachment. Hidden rows, closed sidebars, stale content, detached
DOM, identity attributes alone, native fields hidden by the preview, and deep links do not establish
display. The composition root should resolve the Zotero attachment key to its fresh numeric item ID
before calling this method.

## Reference and dependency decisions

The separation between a pure renderer and a reader lifecycle adapter follows the evaluated
MIT-licensed v0.15.4 architecture of
[`qrkks/zotero-annotation-markdown`](https://github.com/qrkks/zotero-annotation-markdown/tree/f899572eae3214df5096ca5356803b4e1872ee4c).
No source was copied. The current AGPL releases were not adopted.

Runtime dependency versions are pinned in the project lockfile: Markdown-it 15.0.3, KaTeX 0.19.0,
and DOMPurify 3.4.17. Tests use jsdom 29.1.1 only as a development dependency. The renderer-specific
license choices and release notice requirement are recorded in
`src/adapters/rendering/THIRD_PARTY_NOTICES.md`.

The automated tests exercise browser DOM behavior but do not establish Zotero host compatibility.
Installation, selected-passage navigation, native editing, refresh, fallback, and removal behavior
still require the separately controlled Zotero 10.0.6 acceptance run.
