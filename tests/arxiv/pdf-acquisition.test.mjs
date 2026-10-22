import assert from "node:assert/strict";
import test from "node:test";

import { BoundedArxivPdfAcquisition } from "../../dist/adapters/arxiv/index.js";
import { captureError, encoder } from "./helpers.mjs";

class HttpPort {
  resources = [];
  constructor(response) {
    this.response = response;
  }
  async retrieve(resource) {
    this.resources.push(resource);
    return this.response;
  }
}

class PdfInspector {
  calls = [];
  constructor(result = { pageCount: 2 }) {
    this.result = result;
  }
  async inspect(bytes) {
    this.calls.push(Uint8Array.from(bytes));
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class Digest {
  calls = [];
  async digest(bytes) {
    this.calls.push(Uint8Array.from(bytes));
    return "sha256:verified-pdf";
  }
}

test("a readable nonempty PDF is parsed and fingerprinted before acquisition succeeds", async () => {
  const bytes = encoder.encode("%PDF-1.7\nobjects\n%%EOF");
  const http = new HttpPort({ status: 200, contentType: "application/pdf", body: bytes });
  const inspector = new PdfInspector({ pageCount: 7 });
  const digest = new Digest();
  const acquisition = new BoundedArxivPdfAcquisition(http, inspector, digest);
  const source = { arxivId: "2401.01234", version: 2 };

  const result = await acquisition.acquire(source);

  assert.deepEqual(http.resources, [{ kind: "pdf", source }]);
  assert.equal(inspector.calls.length, 1);
  assert.equal(digest.calls.length, 1);
  assert.deepEqual(result, {
    source,
    contentType: "application/pdf",
    body: bytes,
    fingerprint: "sha256:verified-pdf",
    byteLength: bytes.byteLength,
    pageCount: 7,
  });
  assert.notEqual(result.body, bytes);
});

test("a PDF header alone does not substitute for a successful readability parse", async () => {
  const bytes = encoder.encode("%PDF-1.7\nnot a complete document");
  const inspector = new PdfInspector(new Error("cross-reference table is missing"));
  const digest = new Digest();
  const error = await captureError(() => new BoundedArxivPdfAcquisition(
    new HttpPort({ status: 200, contentType: "application/pdf", body: bytes }),
    inspector,
    digest,
  ).acquire({ arxivId: "2401.01234", version: 2 }));
  assert.equal(error.code, "storage_error");
  assert.equal(error.stage, "download");
  assert.equal(error.nativeMutationPossible, false);
  assert.equal(digest.calls.length, 0);
});

test("empty, mislabeled, non-PDF, and zero-page responses fail before native import", async () => {
  const cases = [
    [{ status: 200, contentType: "application/pdf", body: new Uint8Array() }, new PdfInspector()],
    [{ status: 200, contentType: "text/html", body: encoder.encode("challenge") }, new PdfInspector()],
    [{ status: 200, contentType: "application/pdf", body: encoder.encode("not pdf") }, new PdfInspector()],
    [{ status: 200, contentType: "application/pdf", body: encoder.encode("%PDF-1.7\n%%EOF") }, new PdfInspector({ pageCount: 0 })],
  ];
  for (const [response, inspector] of cases) {
    const digest = new Digest();
    const error = await captureError(() => new BoundedArxivPdfAcquisition(
      new HttpPort(response),
      inspector,
      digest,
    ).acquire({ arxivId: "2401.01234", version: 2 }));
    assert.equal(error.code, "storage_error");
    assert.equal(error.nativeMutationPossible, false);
    assert.equal(digest.calls.length, 0);
  }
});
