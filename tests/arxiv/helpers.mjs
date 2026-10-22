import assert from "node:assert/strict";

export const encoder = new TextEncoder();

export function stream(...chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

export function response(url, {
  status = 200,
  contentType = "application/atom+xml",
  body = stream(),
  headers = {},
} = {}) {
  const normalized = new Map(
    Object.entries({ "content-type": contentType, ...headers })
      .map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  return {
    url,
    status,
    headers: {
      get(name) {
        return normalized.get(name.toLowerCase()) ?? null;
      },
    },
    body,
  };
}

export class QueueDriver {
  requests = [];
  queue = [];

  enqueue(value) {
    this.queue.push(value);
    return this;
  }

  async request(input) {
    this.requests.push(input);
    const next = this.queue.shift();
    assert.notEqual(next, undefined, "unexpected HTTP request");
    return typeof next === "function" ? next(input) : next;
  }
}

export async function captureError(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  assert.fail("expected action to reject");
}

export function atomEntry({
  id = "http://arxiv.org/abs/2401.01234v3",
  title = "  A bounded   result ",
  summary = "Evidence from the source.",
  published = "2024-01-03T00:00:00Z",
  updated = "2024-01-05T12:30:00Z",
  authors = ["Ada Lovelace", "Grace Hopper"],
  doi = "10.1000/example",
  comment = "",
} = {}) {
  const authorXml = authors.map((name) => `<author><name>${name}</name></author>`).join("");
  const doiXml = doi == null ? "" : `<arxiv:doi>${doi}</arxiv:doi>`;
  const commentXml = comment === "" ? "" : `<arxiv:comment>${comment}</arxiv:comment>`;
  return `<entry><id>${id}</id><updated>${updated}</updated><published>${published}</published><title>${title}</title><summary>${summary}</summary>${authorXml}${doiXml}${commentXml}</entry>`;
}

export function atomFeed(entries) {
  return encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">${entries.join("")}</feed>`);
}
