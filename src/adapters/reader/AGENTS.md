# Reader preview lifecycle

Attaching disposable previews to actual annotation surfaces and verifying visible current content. Native comments remain canonical; no storage mutation or sanitization implementation here.

Match attachment and annotation ownership, exact normalized current markup, preview mode, and actual reader/surface/body visibility. A background tab must fail. Isolate inaccessible unrelated reader wrappers and attempt all owned cleanup. Toggling source must restore ordinary editable native content.

Test multiple readers including removed/dead wrappers, reload, partial attach, stop failure, stale preview content, hidden surfaces, source/preview transitions, and active versus background ownership. Confirm formatting and navigation in real Zotero.
