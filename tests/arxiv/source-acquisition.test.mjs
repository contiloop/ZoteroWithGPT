import assert from "node:assert/strict";
import test from "node:test";

import { ArxivSourceAcquisition } from "../../dist/adapters/arxiv/index.js";
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
