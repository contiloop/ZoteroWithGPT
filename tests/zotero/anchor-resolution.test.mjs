import assert from "node:assert/strict";
import test from "node:test";

import { ZoteroAnchorResolver } from "../../dist/adapters/anchors/index.js";

function charsFor(text, { y = 100, startX = 10 } = {}) {
  let x = startX;
  return [...text].map((character, index) => {
    const width = character === " " ? 4 : 7;
    const result = {
      text: character,
      rect: [x, y, x + width, y + 10],
      inlineRect: [x, y, x + width, y + 10],
      spaceAfter: false,
      lineBreakAfter: false,
      paragraphBreakAfter: false,
      ignorable: false,
    };
    x += width;
    if (index === text.length - 1) result.lineBreakAfter = true;
    return result;
  });
}

class PageSource {
  fingerprint = "sha256:current-pdf";
  chars = charsFor("alpha target omega; beta target gamma");

  async readAnchorPage(libraryId, attachmentKey, pageIndex) {
    assert.equal(libraryId, "1");
    assert.equal(attachmentKey, "ATTACH01");
    assert.equal(pageIndex, 0);
    return {
      libraryId,
      itemKey: "ITEM0001",
      attachmentKey,
      attachmentFingerprint: this.fingerprint,
      pageIndex,
      pageLabel: "i",
      viewBox: [0, 0, 400, 600],
      chars: structuredClone(this.chars),
    };
  }
}

function request(locator) {
  return {
    protocolVersion: 1,
    operationId: "op.resolve-1",
    operation: "resolve_anchor",
    profileId: "profile-A",
    payload: {
      libraryId: "1",
      attachmentKey: "ATTACH01",
      fingerprint: "sha256:current-pdf",
      pageIndex: 0,
      ...locator,
    },
  };
}

test("a repeated quote stays unresolved and returns every evidenced candidate", async () => {
  const resolver = new ZoteroAnchorResolver(new PageSource());
  const result = await resolver.resolve(request({ quote: { exact: "target" } }));

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /2 matches/i);
  assert.equal(result.candidates.length, 2);
  assert.notDeepEqual(
    result.candidates[0].anchor.rectangles,
    result.candidates[1].anchor.rectangles,
  );
});

test("overlapping text-layer matches remain ambiguous", async () => {
  const source = new PageSource();
  source.chars = charsFor("ababa");
  const resolver = new ZoteroAnchorResolver(source);
  const result = await resolver.resolve(request({ quote: { exact: "aba" } }));

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /2 matches/i);
  assert.equal(result.candidates.length, 2);
});

test("prefix and suffix context select exactly one quote and retain native geometry", async () => {
  const resolver = new ZoteroAnchorResolver(new PageSource());
  const result = await resolver.resolve(
    request({ quote: { exact: "target", prefix: "beta ", suffix: " gamma" } }),
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.anchor.itemKey, "ITEM0001");
  assert.equal(result.anchor.pageLabel, "i");
  assert.equal(result.anchor.selectedText, "target");
  assert.equal(result.anchor.matchEvidence.method, "quote_with_context");
  assert.equal(result.anchor.matchEvidence.exact, true);
  assert.ok(result.anchor.rectangles.every((rect) => rect.x2 > rect.x1 && rect.y2 > rect.y1));

  const revalidated = await resolver.revalidate(result.anchor);
  assert.equal(revalidated.status, "confirmed");
  assert.deepEqual(revalidated.anchor.rectangles, result.anchor.rectangles);
});

test("a quote on a nontext page is unresolved instead of receiving guessed coordinates", async () => {
  const source = new PageSource();
  source.chars = [];
  const resolver = new ZoteroAnchorResolver(source);
  const result = await resolver.resolve(request({ quote: { exact: "diagram label" } }));

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /text layer/i);
  assert.deepEqual(result.candidates, []);
});

test("an inspected region must be inside the current native page bounds", async () => {
  const resolver = new ZoteroAnchorResolver(new PageSource());
  const result = await resolver.resolve(
    request({
      inspectedRegion: {
        rectangles: [{ x1: 390, y1: 590, x2: 430, y2: 620 }],
        selectedText: "target",
      },
    }),
  );

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /page bounds/i);
});

test("arbitrary in-bounds rectangles without live native selection evidence are rejected", async () => {
  const resolver = new ZoteroAnchorResolver(new PageSource());
  const result = await resolver.resolve(
    request({
      inspectedRegion: {
        rectangles: [{ x1: 10, y1: 100, x2: 40, y2: 110 }],
      },
    }),
  );

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /live native reader selection/i);
});

test("selected text must match the supplied native text-layer geometry", async () => {
  const resolver = new ZoteroAnchorResolver(new PageSource());
  const result = await resolver.resolve(
    request({
      inspectedRegion: {
        rectangles: [{ x1: 10, y1: 100, x2: 390, y2: 110 }],
        selectedText: "target",
      },
    }),
  );

  assert.equal(result.status, "unresolved");
  assert.match(result.reason, /text-layer geometry/i);
});

test("revalidation reports a changed PDF fingerprint without attempting a match", async () => {
  const source = new PageSource();
  const resolver = new ZoteroAnchorResolver(source);
  const resolved = await resolver.resolve(
    request({ quote: { exact: "target", prefix: "beta ", suffix: " gamma" } }),
  );
  assert.equal(resolved.status, "resolved");

  source.fingerprint = "sha256:replacement-pdf";
  const revalidated = await resolver.revalidate(resolved.anchor);
  assert.equal(revalidated.status, "stale_attachment");
  assert.equal(revalidated.actualFingerprint, "sha256:replacement-pdf");
});
