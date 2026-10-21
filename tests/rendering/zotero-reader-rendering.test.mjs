import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { ZoteroReaderRenderingAdapter } from "../../dist/adapters/reader/index.js";
import { SafeMarkdownRenderer } from "../../dist/adapters/rendering/index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function readerFixture({ annotationKey = "ANNOT01", attachmentItemId = 42 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <main id="annotationsView">
        <div class="annotation selected" data-sidebar-annotation-id="${annotationKey}">
          <div class="preview">
            <div class="comment"><div class="content" contenteditable="true"></div></div>
          </div>
        </div>
      </main>
    </body></html>`,
    { url: "https://reader.invalid/", pretendToBeVisual: true },
  );
  const document = dom.window.document;
  const reader = {
    itemID: attachmentItemId,
    _initPromise: Promise.resolve(),
    _iframeWindow: { document },
    _internalReader: {
      _primaryView: { initializedPromise: Promise.resolve() },
      _state: {
        sidebarOpen: true,
        sidebarView: "annotations",
        selectedAnnotationIDs: [annotationKey],
      },
    },
  };
  const links = [];
  const host = { Reader: { _readers: [reader] } };
  const renderer = new SafeMarkdownRenderer({ window: dom.window });
  const adapter = new ZoteroReaderRenderingAdapter({
    host,
    renderer,
    openLink: (url) => links.push(url),
    scanIntervalMilliseconds: 60_000,
  });
  const editor = document.querySelector(".comment .content");
  return { adapter, attachmentItemId, document, dom, editor, host, links, reader, annotationKey };
}

function setEditorText(editor, value) {
  editor.textContent = value;
}

function giveLayout(node, rect = { left: 10, right: 410, top: 20, bottom: 500 }) {
  node.getClientRects = () => ({ length: 1, item: () => rect, 0: rect });
  node.getBoundingClientRect = () => rect;
}

test("adds a full formatted preview beside the native editor and preserves passage navigation", async () => {
  const fixture = readerFixture();
  const source = [
    "질문: 이 귀납 단계가 왜 성립하나요?",
    "",
    "1. $s_0=1$",
    "2. $s_k=k+1$을 가정",
    "3. $$s_{k+1}=s_k+1=k+2$$",
    "",
    "[reference](https://example.org/paper)",
  ].join("\n");
  setEditorText(fixture.editor, source);
  let nativeClicks = 0;
  fixture.document.querySelector(".annotation").addEventListener("click", () => nativeClicks += 1);

  await fixture.adapter.start();
  await fixture.adapter.refresh();

  const preview = fixture.document.querySelector("[data-zotero-gpt-rendered-comment]");
  assert.ok(preview);
  assert.match(preview.textContent, /귀납 단계/u);
  assert.ok(preview.querySelector("math"));
  assert.equal(preview.querySelector("a")?.getAttribute("href"), "https://example.org/paper");
  assert.equal(preview.style.maxHeight, "none");
  assert.equal(preview.style.overflowY, "visible");
  assert.equal(fixture.editor.getAttribute("contenteditable"), "true");
  assert.equal(fixture.editor.hidden, false);
  const comment = fixture.document.querySelector(".comment");
  const toggle = preview.querySelector("[data-zotero-gpt-toggle-source]");
  assert.equal(comment.getAttribute("data-zotero-gpt-comment-mode"), "preview");
  assert.equal(fixture.dom.window.getComputedStyle(fixture.editor).display, "none");
  assert.equal(toggle.textContent, "Edit native comment");

  toggle.dispatchEvent(new fixture.dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(comment.getAttribute("data-zotero-gpt-comment-mode"), "source");
  assert.notEqual(fixture.dom.window.getComputedStyle(fixture.editor).display, "none");
  assert.equal(toggle.textContent, "Show formatted comment");
  toggle.dispatchEvent(new fixture.dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(comment.getAttribute("data-zotero-gpt-comment-mode"), "preview");

  preview.querySelector("p").dispatchEvent(new fixture.dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(nativeClicks, 1, "ordinary preview clicks retain the native annotation navigation path");

  preview.querySelector("a").dispatchEvent(
    new fixture.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  assert.deepEqual(fixture.links, ["https://example.org/paper"]);
  fixture.adapter.stop();
});

test("refreshes after an ordinary native edit and removal restores the native DOM", async () => {
  const fixture = readerFixture();
  setEditorText(fixture.editor, "before $x$");
  const originalChildren = fixture.document.querySelector(".comment").childElementCount;
  await fixture.adapter.start();
  await fixture.adapter.refresh();

  setEditorText(fixture.editor, "수동 편집 후 $y^2$");
  await fixture.adapter.refresh();
  const preview = fixture.document.querySelector("[data-zotero-gpt-rendered-comment]");
  assert.match(preview.textContent, /수동 편집 후/u);
  assert.ok(preview.querySelector("math"));

  fixture.adapter.stop();
  assert.equal(fixture.document.querySelector("[data-zotero-gpt-rendered-comment]"), null);
  assert.equal(fixture.document.querySelector("style[data-zotero-gpt-reader-style]"), null);
  assert.equal(fixture.document.querySelector(".comment").hasAttribute("data-zotero-gpt-comment-mode"), false);
  assert.equal(fixture.document.querySelector(".comment").childElementCount, originalChildren);
  assert.equal(fixture.editor.getAttribute("contenteditable"), "true");
});

test("verifies only a currently visible preview with exact attachment, annotation, and fresh content", async () => {
  const fixture = readerFixture();
  const expected = "긴 설명과 $x^2$";
  setEditorText(fixture.editor, expected);
  await fixture.adapter.start();
  await fixture.adapter.refresh();
  const preview = fixture.document.querySelector("[data-zotero-gpt-rendered-comment]");
  giveLayout(preview);
  giveLayout(fixture.document.querySelector(".annotation"));

  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: expected,
    }),
    true,
  );
  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId + 1,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: expected,
    }),
    false,
  );
  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: "OTHER01",
      expectedNativeComment: expected,
    }),
    false,
  );
  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: "stale native comment",
    }),
    false,
  );

  fixture.reader._internalReader._state.sidebarOpen = false;
  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: expected,
    }),
    false,
  );
  fixture.adapter.stop();
});

test("checks every open reader for the exact attachment instead of accepting a hidden duplicate", async () => {
  const hidden = readerFixture();
  const visible = readerFixture();
  const expected = "두 번째 창에서 보이는 $q$ 설명";
  hidden.reader._internalReader._state.sidebarOpen = false;
  setEditorText(hidden.editor, expected);
  setEditorText(visible.editor, expected);
  hidden.host.Reader._readers.push(visible.reader);

  await hidden.adapter.start();
  await hidden.adapter.refresh();
  const preview = visible.document.querySelector("[data-zotero-gpt-rendered-comment]");
  giveLayout(preview);
  giveLayout(visible.document.querySelector(".annotation"));

  assert.equal(
    await hidden.adapter.verifyVisiblePreview({
      attachmentItemId: hidden.attachmentItemId,
      annotationKey: hidden.annotationKey,
      expectedNativeComment: expected,
    }),
    true,
  );
  hidden.adapter.stop();
});

test("reattaches after a reader document reload and cleans the replaced document", async () => {
  const fixture = readerFixture();
  const replacement = readerFixture();
  setEditorText(fixture.editor, "before reload");
  setEditorText(replacement.editor, "after reload $r^2$");
  await fixture.adapter.start();
  await fixture.adapter.refresh();
  assert.ok(fixture.document.querySelector("[data-zotero-gpt-rendered-comment]"));

  fixture.reader._iframeWindow.document = replacement.document;
  await fixture.adapter.refresh();

  assert.equal(fixture.document.querySelector("[data-zotero-gpt-rendered-comment]"), null);
  assert.equal(fixture.document.querySelector("style[data-zotero-gpt-reader-style]"), null);
  assert.match(
    replacement.document.querySelector("[data-zotero-gpt-rendered-comment]").textContent,
    /after reload/u,
  );
  fixture.adapter.stop();
});

test("renders and verifies the selected annotation popup when the sidebar is closed", async () => {
  const fixture = readerFixture();
  fixture.reader._internalReader._state.sidebarOpen = false;
  const popup = fixture.document.createElement("div");
  popup.className = "annotation-popup";
  popup.innerHTML = '<div class="comment"><div class="content" contenteditable="true"></div></div>';
  fixture.document.body.append(popup);
  const expected = "선택한 주석의 $z$ 설명";
  setEditorText(popup.querySelector(".content"), expected);

  await fixture.adapter.start();
  await fixture.adapter.refresh();
  const preview = popup.querySelector("[data-zotero-gpt-rendered-comment]");
  assert.ok(preview);
  assert.equal(preview.getAttribute("data-zotero-annotation-key"), fixture.annotationKey);
  giveLayout(preview);
  giveLayout(popup);

  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: expected,
    }),
    true,
  );
  fixture.reader._internalReader._state.selectedAnnotationIDs = ["OTHER01"];
  assert.equal(
    await fixture.adapter.verifyVisiblePreview({
      attachmentItemId: fixture.attachmentItemId,
      annotationKey: fixture.annotationKey,
      expectedNativeComment: expected,
    }),
    false,
  );
  fixture.adapter.stop();
});

test("a rendering failure removes owned previews and keeps the native editor usable", async () => {
  const fixture = readerFixture();
  setEditorText(fixture.editor, "canonical native comment");
  const renderer = {
    async render() {
      throw new Error("synthetic adapter failure");
    },
  };
  const adapter = new ZoteroReaderRenderingAdapter({
    host: fixture.host,
    renderer,
    openLink() {},
    scanIntervalMilliseconds: 60_000,
  });

  await assert.rejects(adapter.start(), /synthetic adapter failure/u);
  await flush();

  assert.equal(fixture.document.querySelector("[data-zotero-gpt-rendered-comment]"), null);
  assert.equal(fixture.editor.textContent, "canonical native comment");
  assert.equal(fixture.editor.getAttribute("contenteditable"), "true");
  adapter.stop();
});
