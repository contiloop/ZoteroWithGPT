import assert from "node:assert/strict";
import test from "node:test";

import { ArxivSourceAcquisition } from "../../dist/adapters/arxiv/index.js";
import { parseSafeXml } from "../../dist/adapters/arxiv/atom.js";
import { atomEntry, atomFeed, captureError, encoder } from "./helpers.mjs";

class HttpPort {
  constructor(response) {
    this.response = response;
  }
  resources = [];
  async retrieve(resource) {
    this.resources.push(resource);
    return this.response;
  }
}

function metadataResponse(body, contentType = "application/atom+xml") {
  return { status: 200, contentType, body };
}

test("an unversioned reference resolves one concrete source with supplied metadata", async () => {
  const http = new HttpPort(metadataResponse(atomFeed([atomEntry()])))
  const source = await new ArxivSourceAcquisition(http).inspect({ arxivId: "2401.01234" });

  assert.deepEqual(http.resources, [{
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }]);
  assert.deepEqual(source, {
    arxivId: "2401.01234",
    version: 3,
    abstractUrl: "https://arxiv.org/abs/2401.01234v3",
    pdfUrl: "https://arxiv.org/pdf/2401.01234v3",
    metadata: {
      title: "A bounded result",
      authors: ["Ada Lovelace", "Grace Hopper"],
      published: "2024-01-03T00:00:00Z",
      updated: "2024-01-05T12:30:00Z",
      abstract: "Evidence from the source.",
      doi: "10.1000/example",
    },
  });
});

test("explicit modern and legacy versions must match the sole Atom entry", async () => {
  for (const [reference, id] of [
    [{ arxivId: "2401.01234", version: 2 }, "https://arxiv.org/abs/2401.01234v2"],
    [{ arxivId: "hep-th/9901001", version: 4 }, "http://arxiv.org/abs/hep-th/9901001v4"],
  ]) {
    const http = new HttpPort(metadataResponse(atomFeed([atomEntry({ id, doi: null })])));
    const source = await new ArxivSourceAcquisition(http).inspect(reference);
    assert.deepEqual(
      { arxivId: source.arxivId, version: source.version },
      { arxivId: reference.arxivId, version: reference.version },
    );
    assert.equal("doi" in source.metadata, false);
  }
});

test("missing, mismatched, error, withdrawn, and duplicate entries never become sources", async () => {
  const cases = [
    [atomFeed([]), "not_found"],
    [atomFeed([atomEntry({ id: "https://arxiv.org/abs/2401.01234v4" })]), "not_found"],
    [atomFeed([atomEntry({ id: "http://arxiv.org/api/errors#incorrect_id_format", title: "Error" })]), "not_found"],
    [atomFeed([atomEntry({ comment: "Withdrawn by the authors" })]), "not_found"],
    [atomFeed([atomEntry({ summary: "This paper has been withdrawn by the authors." })]), "not_found"],
    [atomFeed([atomEntry(), atomEntry()]), "storage_error"],
  ];
  for (const [body, code] of cases) {
    const error = await captureError(() => new ArxivSourceAcquisition(
      new HttpPort(metadataResponse(body)),
    ).inspect({ arxivId: "2401.01234", version: 3 }));
    assert.equal(error.code, code);
    assert.equal(error.nativeMutationPossible, false);
  }
});

test("malformed and external-entity XML is rejected without entity resolution", async () => {
  for (const body of [
    encoder.encode("<feed><entry></feed>"),
    encoder.encode('<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><feed><entry><title>&xxe;</title></entry></feed>'),
    encoder.encode("<feed><entry><title>&unknown;</title></entry></feed>"),
  ]) {
    const error = await captureError(() => new ArxivSourceAcquisition(
      new HttpPort(metadataResponse(body)),
    ).inspect({ arxivId: "2401.01234" }));
    assert.equal(error.code, "storage_error");
    assert.match(error.message, /metadata|XML/i);
  }
});

test("a minimal API error entry is not mistaken for malformed empty success", async () => {
  const body = encoder.encode('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title><summary>Bad identifier</summary></entry></feed>');
  const error = await captureError(() => new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(body)),
  ).inspect({ arxivId: "2401.01234" }));
  assert.equal(error.code, "not_found");
});

test("non-Atom content and invalid required metadata are not accepted", async () => {
  const html = await captureError(() => new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(encoder.encode("<html>challenge</html>"), "text/html")),
  ).inspect({ arxivId: "2401.01234" }));
  assert.equal(html.code, "storage_error");

  const missingAuthor = await captureError(() => new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(atomFeed([atomEntry({ authors: [] })]))),
  ).inspect({ arxivId: "2401.01234" }));
  assert.equal(missingAuthor.code, "storage_error");

  const wrongNamespaceText = new TextDecoder().decode(atomFeed([atomEntry()]))
    .replace("http://www.w3.org/2005/Atom", "https://evil.example/not-atom");
  const namespaceError = await captureError(() => new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(encoder.encode(wrongNamespaceText))),
  ).inspect({ arxivId: "2401.01234" }));
  assert.equal(namespaceError.code, "storage_error");
});

test("Atom and arXiv fields are selected by their in-scope namespace URI", async () => {
  const prefixed = encoder.encode(`<?xml version="1.0"?>
    <a:feed xmlns:a="http://www.w3.org/2005/Atom">
      <a:entry>
        <a:id>https://arxiv.org/abs/2401.01234v3</a:id>
        <a:updated>2024-01-05T12:30:00Z</a:updated>
        <a:published>2024-01-03T00:00:00Z</a:published>
        <a:title>Namespaced result</a:title>
        <a:summary>Namespaced evidence.</a:summary>
        <a:author><a:name>Ada Lovelace</a:name></a:author>
        <ext:doi xmlns:ext="http://arxiv.org/schemas/atom">10.1000/local</ext:doi>
      </a:entry>
    </a:feed>`);
  const source = await new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(prefixed)),
  ).inspect({ arxivId: "2401.01234" });
  assert.equal(source.metadata.title, "Namespaced result");
  assert.equal(source.metadata.doi, "10.1000/local");

  const foreignEntry = encoder.encode(`
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry xmlns="urn:not-atom">
        <id>https://arxiv.org/abs/2401.01234v3</id>
        <updated>2024-01-05T12:30:00Z</updated>
        <published>2024-01-03T00:00:00Z</published>
        <title>Foreign entry</title><summary>Foreign.</summary>
        <author><name>Unknown</name></author>
      </entry>
    </feed>`);
  const missing = await captureError(() => new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(foreignEntry)),
  ).inspect({ arxivId: "2401.01234" }));
  assert.equal(missing.code, "not_found");

  const rebound = new TextDecoder().decode(atomFeed([atomEntry()])).replace(
    "<arxiv:doi>10.1000/example</arxiv:doi>",
    '<arxiv:doi xmlns:arxiv="urn:foreign">10.1000/foreign</arxiv:doi>',
  );
  const withoutForeignDoi = await new ArxivSourceAcquisition(
    new HttpPort(metadataResponse(encoder.encode(rebound))),
  ).inspect({ arxivId: "2401.01234" });
  assert.equal("doi" in withoutForeignDoi.metadata, false);
});

test("XML rejects normalized tag whitespace and illegal raw characters", async () => {
  const malformedEntry = new TextDecoder().decode(atomFeed([atomEntry()]))
    .replace("<entry>", "< entry>");
  for (const body of [
    encoder.encode(malformedEntry),
    atomFeed([atomEntry({ title: "bad\u0000title" })]),
    encoder.encode(new TextDecoder().decode(atomFeed([atomEntry()])).replace(
      "A bounded   result",
      "A bounded &#x0; result",
    )),
  ]) {
    const error = await captureError(() => new ArxivSourceAcquisition(
      new HttpPort(metadataResponse(body)),
    ).inspect({ arxivId: "2401.01234" }));
    assert.equal(error.code, "storage_error");
  }
  assert.throws(
    () => parseSafeXml('<feed xmlns="http://www.w3.org/2005/Atom">\uD800</feed>'),
    /character|XML/i,
  );
});

test("source timestamps use strict calendar dates and chronological instants", async () => {
  for (const entry of [
    atomEntry({ published: "2024-02-30T00:00:00Z", updated: "2024-03-01T00:00:00Z" }),
    atomEntry({ published: "2024-02-29T12:00:00+09:00", updated: "2024-02-29T02:59:59Z" }),
  ]) {
    const error = await captureError(() => new ArxivSourceAcquisition(
      new HttpPort(metadataResponse(atomFeed([entry]))),
    ).inspect({ arxivId: "2401.01234" }));
    assert.equal(error.code, "storage_error");
  }

  for (const entry of [
    atomEntry({ published: "2024-02-29T00:00:00Z", updated: "2024-02-29T00:00:01Z" }),
    atomEntry({ published: "2024-02-29T12:00:00+09:00", updated: "2024-02-29T04:00:00Z" }),
  ]) {
    const source = await new ArxivSourceAcquisition(
      new HttpPort(metadataResponse(atomFeed([entry]))),
    ).inspect({ arxivId: "2401.01234" });
    assert.equal(source.version, 3);
  }
});
