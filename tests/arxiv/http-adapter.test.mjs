import assert from "node:assert/strict";
import test from "node:test";

import {
  BoundedArxivHttpAdapter,
  MAX_ARXIV_METADATA_BYTES,
  MAX_ARXIV_PDF_BYTES,
} from "../../dist/adapters/arxiv/index.js";
import { captureError, encoder, QueueDriver, response, stream } from "./helpers.mjs";

test("typed resources construct fixed HTTPS metadata and PDF requests", async () => {
  const driver = new QueueDriver()
    .enqueue(response(
      "https://export.arxiv.org/api/query?id_list=hep-th%2F9901001v3&max_results=1",
      { body: stream(encoder.encode("metadata")) },
    ))
    .enqueue(response("https://arxiv.org/pdf/2401.01234v2", {
      contentType: "application/pdf",
      body: stream(encoder.encode("pdf")),
    }));
  const adapter = new BoundedArxivHttpAdapter(driver);

  await adapter.retrieve({
    kind: "metadata",
    reference: { arxivId: "hep-th/9901001", version: 3 },
  });
  await adapter.retrieve({ kind: "pdf", source: { arxivId: "2401.01234", version: 2 } });

  assert.deepEqual(driver.requests.map(({ url }) => url), [
    "https://export.arxiv.org/api/query?id_list=hep-th%2F9901001v3&max_results=1",
    "https://arxiv.org/pdf/2401.01234v2",
  ]);
  assert.ok(driver.requests.every(({ redirect }) => redirect === "manual"));
  assert.deepEqual(driver.requests.map(({ byteLimit }) => byteLimit), [
    MAX_ARXIV_METADATA_BYTES,
    MAX_ARXIV_PDF_BYTES,
  ]);
});

test("the network boundary accepts only streamed bodies and reassembles bounded chunks", async () => {
  const url = "https://export.arxiv.org/api/query?id_list=2401.01234&max_results=1";
  const streamed = new QueueDriver().enqueue(response(url, {
    body: stream(encoder.encode("bounded "), encoder.encode("metadata")),
  }));
  const result = await new BoundedArxivHttpAdapter(streamed).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  });
  assert.equal(new TextDecoder().decode(result.body), "bounded metadata");

  const buffered = new QueueDriver().enqueue(response(url, {
    body: encoder.encode("already allocated"),
  }));
  const error = await captureError(() => new BoundedArxivHttpAdapter(buffered).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }));
  assert.equal(error.code, "storage_error");
  assert.match(error.message, /stream/i);
});

test("every redirect and final response URL is checked against the typed resource", async () => {
  const initial = "https://export.arxiv.org/api/query?id_list=2401.01234&max_results=1";
  const redirected = "https://arxiv.org/api/query?id_list=2401.01234&max_results=1";
  const allowed = new QueueDriver()
    .enqueue(response(initial, { status: 302, headers: { location: redirected } }))
    .enqueue(response(redirected, { body: stream(encoder.encode("ok")) }));
  await new BoundedArxivHttpAdapter(allowed).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  });
  assert.equal(allowed.requests.length, 2);

  for (const location of [
    "https://example.com/api/query?id_list=2401.01234&max_results=1",
    "https://arxiv.org.evil.example/api/query?id_list=2401.01234&max_results=1",
    "https://user:secret@arxiv.org/api/query?id_list=2401.01234&max_results=1",
    "https://arxiv.org:8443/api/query?id_list=2401.01234&max_results=1",
    "https://127.0.0.1/api/query?id_list=2401.01234&max_results=1",
    "https://arxiv.org/abs/2401.01234",
  ]) {
    const driver = new QueueDriver().enqueue(response(initial, {
      status: 302,
      headers: { location },
    }));
    const error = await captureError(() => new BoundedArxivHttpAdapter(driver).retrieve({
      kind: "metadata",
      reference: { arxivId: "2401.01234" },
    }));
    assert.equal(error.code, "storage_error", location);
    assert.equal(error.nativeMutationPossible, false);
    assert.equal(driver.requests.length, 1);
  }

  const hiddenRedirect = new QueueDriver().enqueue(response(
    "https://evil.example/api/query?id_list=2401.01234&max_results=1",
    { body: stream(encoder.encode("unexpected")) },
  ));
  const finalError = await captureError(() => new BoundedArxivHttpAdapter(hiddenRedirect).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }));
  assert.equal(finalError.code, "storage_error");
  assert.match(finalError.message, /final response URL/i);
});

test("a fourth redirect is rejected without another request", async () => {
  const url = "https://arxiv.org/pdf/2401.01234v2";
  const driver = new QueueDriver();
  for (let index = 0; index < 4; index += 1) {
    driver.enqueue(response(url, { status: 302, headers: { location: url } }));
  }
  const error = await captureError(() => new BoundedArxivHttpAdapter(driver).retrieve({
    kind: "pdf",
    source: { arxivId: "2401.01234", version: 2 },
  }));
  assert.equal(error.code, "storage_error");
  assert.match(error.message, /redirect limit/i);
  assert.equal(driver.requests.length, 4);
});

test("declared, streamed, and truncated bodies fail within bounded allocation", async () => {
  const url = "https://export.arxiv.org/api/query?id_list=2401.01234&max_results=1";
  let bodyRead = false;
  const overDeclared = new QueueDriver().enqueue(response(url, {
    headers: { "content-length": MAX_ARXIV_METADATA_BYTES + 1 },
    body: {
      async *[Symbol.asyncIterator]() {
        bodyRead = true;
        yield encoder.encode("never read");
      },
    },
  }));
  let error = await captureError(() => new BoundedArxivHttpAdapter(overDeclared).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }));
  assert.equal(error.code, "too_large");
  assert.equal(bodyRead, false);

  const overStreamed = new QueueDriver().enqueue(response(url, {
    body: {
      async *[Symbol.asyncIterator]() {
        yield encoder.encode("1234");
        yield encoder.encode("5678");
      },
    },
  }));
  error = await captureError(() => new BoundedArxivHttpAdapter(overStreamed, {
    metadataByteLimit: 7,
  }).retrieve({ kind: "metadata", reference: { arxivId: "2401.01234" } }));
  assert.equal(error.code, "too_large");

  const truncated = new QueueDriver().enqueue(response(url, {
    headers: { "content-length": 10 },
    body: stream(encoder.encode("short")),
  }));
  error = await captureError(() => new BoundedArxivHttpAdapter(truncated).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }));
  assert.equal(error.code, "storage_error");
  assert.match(error.message, /truncated|length/i);

  const pdfUrl = "https://arxiv.org/pdf/2401.01234v2";
  const pdf = new QueueDriver().enqueue(response(pdfUrl, {
    contentType: "application/pdf",
    body: stream(encoder.encode("12345678")),
  }));
  error = await captureError(() => new BoundedArxivHttpAdapter(pdf, {
    pdfByteLimit: 7,
  }).retrieve({ kind: "pdf", source: { arxivId: "2401.01234", version: 2 } }));
  assert.equal(error.code, "too_large");
});

test("deadline and caller cancellation stop an in-flight network attempt", async () => {
  const waiting = () => new QueueDriver().enqueue(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("driver aborted")), { once: true });
  }));
  let error = await captureError(() => new BoundedArxivHttpAdapter(waiting(), {
    attemptTimeoutMs: 5,
  }).retrieve({ kind: "metadata", reference: { arxivId: "2401.01234" } }));
  assert.equal(error.code, "storage_error");
  assert.match(error.message, /deadline/i);
  assert.equal(error.nativeMutationPossible, false);

  const controller = new AbortController();
  const adapter = new BoundedArxivHttpAdapter(waiting());
  const pending = adapter.retrieve(
    { kind: "metadata", reference: { arxivId: "2401.01234" } },
    { signal: controller.signal },
  );
  controller.abort();
  error = await captureError(() => pending);
  assert.equal(error.code, "storage_error");
  assert.match(error.message, /cancel/i);
});

test("deadline and cancellation close an in-flight response stream", async () => {
  const url = "https://export.arxiv.org/api/query?id_list=2401.01234&max_results=1";
  const stalled = () => {
    let closed = false;
    const body = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return new Promise(() => {});
          },
          async return() {
            closed = true;
            return { done: true };
          },
        };
      },
    };
    return { body, wasClosed: () => closed };
  };

  const deadlineStream = stalled();
  let error = await captureError(() => new BoundedArxivHttpAdapter(
    new QueueDriver().enqueue(response(url, { body: deadlineStream.body })),
    { attemptTimeoutMs: 5 },
  ).retrieve({ kind: "metadata", reference: { arxivId: "2401.01234" } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(error.message, /deadline/i);
  assert.equal(deadlineStream.wasClosed(), true);

  const cancelledStream = stalled();
  const controller = new AbortController();
  const pending = new BoundedArxivHttpAdapter(
    new QueueDriver().enqueue(response(url, { body: cancelledStream.body })),
  ).retrieve(
    { kind: "metadata", reference: { arxivId: "2401.01234" } },
    { signal: controller.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  error = await captureError(() => pending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(error.message, /cancel/i);
  assert.equal(cancelledStream.wasClosed(), true);
});

test("HTTP 429 exposes Retry-After without an automatic retry", async () => {
  const url = "https://export.arxiv.org/api/query?id_list=2401.01234&max_results=1";
  const driver = new QueueDriver().enqueue(response(url, {
    status: 429,
    headers: { "retry-after": "120" },
  }));
  const error = await captureError(() => new BoundedArxivHttpAdapter(driver).retrieve({
    kind: "metadata",
    reference: { arxivId: "2401.01234" },
  }));
  assert.equal(error.code, "storage_error");
  assert.equal(error.retryable, true);
  assert.equal(error.retryAfterSeconds, 120);
  assert.equal(error.stage, "source");
  assert.equal(driver.requests.length, 1);
});

test("access denial and challenge statuses are reported without retry or fallback", async () => {
  const url = "https://arxiv.org/pdf/2401.01234v2";
  for (const status of [401, 403]) {
    const driver = new QueueDriver().enqueue(response(url, {
      status,
      contentType: "text/html",
      body: stream(encoder.encode("challenge")),
    }));
    const error = await captureError(() => new BoundedArxivHttpAdapter(driver).retrieve({
      kind: "pdf",
      source: { arxivId: "2401.01234", version: 2 },
    }));
    assert.equal(error.code, "storage_error");
    assert.equal(error.retryable, false);
    assert.equal(error.stage, "download");
    assert.equal(driver.requests.length, 1);
  }
});
