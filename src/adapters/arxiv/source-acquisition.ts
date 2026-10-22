import type { ArxivHttpPort, ArxivSourceAcquisitionPort } from "../../ports/arxiv.js";
import type { ArxivSource, ArxivUrlReference } from "../../protocol/types.js";
import {
  arxivAbstractUrl,
  arxivPdfUrl,
  parseArxivUrl,
  ProtocolValidationError,
} from "../../protocol/validation.js";
import { ArxivAcquisitionError } from "./errors.js";
import { atomEntries, parseSafeXml, type AtomEntryFields } from "./atom.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const ATOM_CONTENT_TYPES = new Set(["application/atom+xml", "application/xml", "text/xml"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function normalizeSpace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function requiredText(value: string, field: string): string {
  const normalized = normalizeSpace(value);
  if (normalized === "") {
    throw new ArxivAcquisitionError(
      "storage_error",
      `The arXiv metadata entry has an empty ${field}`,
      { stage: "source" },
    );
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (!ISO_TIMESTAMP.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new ArxivAcquisitionError(
      "storage_error",
      `The arXiv metadata entry has an invalid ${field} timestamp`,
      { stage: "source" },
    );
  }
  return normalized;
}

function isErrorEntry(entry: AtomEntryFields): boolean {
  return /\/api\/errors(?:#|\/)/iu.test(entry.id) && /^error\b/iu.test(normalizeSpace(entry.title));
}

function isWithdrawn(entry: AtomEntryFields): boolean {
  const marker = /^(?:(?:(?:this|the)\s+)?(?:paper|submission)\s+(?:has\s+been\s+)?)?withdrawn\b/iu;
  return (
    marker.test(normalizeSpace(entry.comment ?? "")) ||
    marker.test(normalizeSpace(entry.title)) ||
    marker.test(normalizeSpace(entry.summary))
  );
}

function entryIdentity(entry: AtomEntryFields): { arxivId: string; version: number } {
  let url: URL;
  try {
    url = new URL(entry.id.trim());
  } catch {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv metadata entry has a malformed identity URL",
      { stage: "source" },
    );
  }
  if (!url.pathname.startsWith("/abs/") || url.search !== "" || url.hash !== "") {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv metadata entry does not identify an abstract route",
      { stage: "source" },
    );
  }
  let reference: ArxivUrlReference;
  try {
    reference = parseArxivUrl(entry.id.trim());
  } catch (error) {
    if (error instanceof ProtocolValidationError) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata entry has an invalid article identity",
        { stage: "source" },
      );
    }
    throw error;
  }
  if (reference.version === undefined) {
    throw new ArxivAcquisitionError(
      "storage_error",
      "The arXiv metadata entry did not resolve a concrete version",
      { stage: "source" },
    );
  }
  return { arxivId: reference.arxivId, version: reference.version };
}

export class ArxivSourceAcquisition implements ArxivSourceAcquisitionPort {
  readonly #http: ArxivHttpPort;

  constructor(http: ArxivHttpPort) {
    this.#http = http;
  }

  async inspect(reference: ArxivUrlReference): Promise<ArxivSource> {
    let response;
    try {
      response = await this.#http.retrieve({ kind: "metadata", reference: { ...reference } });
    } catch (error) {
      if (error instanceof ArxivAcquisitionError || error instanceof ProtocolValidationError) throw error;
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata request failed before a complete response was available",
        { stage: "source", retryable: true },
      );
    }
    if (response.status !== 200) {
      throw new ArxivAcquisitionError(
        response.status === 404 || response.status === 410 ? "not_found" : "storage_error",
        "The arXiv metadata response was not successful",
        { stage: "source", retryable: response.status >= 500 || response.status === 429 },
      );
    }
    const contentType = response.contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!ATOM_CONTENT_TYPES.has(contentType)) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata response was not Atom XML",
        { stage: "source" },
      );
    }

    let entries: AtomEntryFields[];
    try {
      entries = atomEntries(parseSafeXml(decoder.decode(response.body)));
    } catch (error) {
      if (error instanceof ArxivAcquisitionError) throw error;
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata XML was malformed or unsafe",
        { stage: "source" },
      );
    }
    if (entries.length === 0) {
      throw new ArxivAcquisitionError("not_found", "The arXiv metadata feed contained no article", {
        stage: "source",
      });
    }
    if (entries.some(isErrorEntry)) {
      throw new ArxivAcquisitionError("not_found", "The arXiv metadata feed reported an error", {
        stage: "source",
      });
    }
    if (entries.length !== 1) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The fixed arXiv metadata query returned more than one entry",
        { stage: "source" },
      );
    }
    const entry = entries[0] as AtomEntryFields;
    if (isWithdrawn(entry)) {
      throw new ArxivAcquisitionError("not_found", "The requested arXiv article is withdrawn", {
        stage: "source",
      });
    }
    const identity = entryIdentity(entry);
    if (
      identity.arxivId !== reference.arxivId ||
      (reference.version !== undefined && identity.version !== reference.version)
    ) {
      throw new ArxivAcquisitionError(
        "not_found",
        "The arXiv metadata entry did not match the requested article version",
        { stage: "source" },
      );
    }
    if (entry.authors.length === 0) {
      throw new ArxivAcquisitionError(
        "storage_error",
        "The arXiv metadata entry did not contain any creator names",
        { stage: "source" },
      );
    }
    const authors = entry.authors.map((author) => requiredText(author, "author name"));
    const doi = normalizeSpace(entry.doi ?? "");
    return {
      ...identity,
      abstractUrl: arxivAbstractUrl(identity),
      pdfUrl: arxivPdfUrl(identity),
      metadata: {
        title: requiredText(entry.title, "title"),
        authors,
        published: timestamp(entry.published, "published"),
        updated: timestamp(entry.updated, "updated"),
        abstract: normalizeSpace(entry.summary),
        ...(doi === "" ? {} : { doi }),
      },
    };
  }
}
