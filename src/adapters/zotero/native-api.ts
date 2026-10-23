import type {
  ArxivSource,
  ArxivUrlReference,
  LocalArxivEvidence,
  ResolvedAnchor,
  TransportDescription,
} from "../../protocol/types.js";
import type {
  ArxivNativeInspection,
} from "../../ports/arxiv.js";
import type { NativePageChar, NativeRectTuple } from "../anchors/text-layer.js";

export interface NativeRuntimeStatus {
  zoteroVersion: string;
  profileName?: string;
}

export interface NativeAttachmentSummary {
  attachmentKey: string;
  title: string;
  contentType: string;
  fingerprint?: string;
}

export interface NativePaperRecord {
  libraryId: string;
  itemKey: string;
  title: string;
  creators: string[];
  year?: number;
  attachments: NativeAttachmentSummary[];
}

export interface NativeLocalArxivMatch {
  paper: NativePaperRecord;
  evidence: LocalArxivEvidence[];
}

export interface NativeLocalArxivDiscovery {
  matches: NativeLocalArxivMatch[];
  truncated: boolean;
}

export interface NativePdfAttachment {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  title: string;
  contentType: string;
  fingerprint: string;
  revision: string;
  pageCount: number;
}

export interface NativePdfPageRecord {
  pageIndex: number;
  pageLabel: string;
  viewBox: NativeRectTuple;
  chars: NativePageChar[];
}

export interface NativeInspectedRegionEvidence {
  rectangles: ResolvedAnchor["rectangles"];
  selectedText?: string;
}

export interface NativeAnnotationRecord {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  annotationKey: string;
  type: "highlight" | "note";
  text?: string;
  comment: string;
  color?: string;
  pageIndex: number;
  pageLabel: string;
  rectangles: ResolvedAnchor["rectangles"];
  version: number;
  dateModified: string;
  operationMarkers: string[];
  deepLink?: string;
}

export interface NativeNoteRecord {
  libraryId: string;
  itemKey: string;
  noteKey: string;
  title: string;
  content: string;
  version: number;
  dateModified: string;
  operationMarkers: string[];
  deepLink?: string;
}

export type NativeMutationRecord = NativeAnnotationRecord | NativeNoteRecord;

export interface NativeAnnotationCreate {
  anchor: ResolvedAnchor;
  type: "highlight" | "note";
  comment: string;
  color: string;
  operationMarker: string;
}

export interface NativeAnnotationUpdate {
  expected: NativeAnnotationRecord;
  comment: string;
  operationMarker: string;
}

export interface NativeNoteCreate {
  libraryId: string;
  itemKey: string;
  content: string;
  operationMarker: string;
}

export interface NativeNoteUpdate {
  expected: NativeNoteRecord;
  content: string;
  operationMarker: string;
}

export interface NativeArxivParentRecord {
  libraryId: string;
  itemKey: string;
  itemRevision: string;
  /** Parent metadata/collections/identity only; child attachment changes do not alter it. */
  metadataRevision: string;
  title: string;
  canonicalVersions: number[];
  metadataMatchesSource: boolean;
  operationMarkers: string[];
  provenanceMarkers: string[];
  deepLink: string;
}

export interface NativeArxivAttachmentRecord {
  libraryId: string;
  itemKey: string;
  attachmentKey: string;
  fingerprint: string | null;
  readable: boolean;
  pageCount: number | null;
  version: number | null;
  identity: "verified" | "unverified";
  /** Canonical source/version evidence is present and has no conflicting native identity. */
  canonicalSourceEvidence: boolean;
  operationMarkers: string[];
  provenanceMarkers: string[];
  deepLink: string;
}

export type NativeArxivOperationObject =
  | { kind: "parent"; itemKey: string }
  | { kind: "attachment"; itemKey: string; attachmentKey: string };

/** Validate existing native note bytes without sanitizing them in place. */
export interface NativeNoteContentPolicy {
  sanitize(content: string): string;
  accepts(content: string): boolean;
}

/**
 * Narrow boundary around privileged Zotero globals. The library adapter owns
 * protocol policy; a host implementation owns native item and reader calls.
 */
export interface ZoteroNativeApi {
  runtimeStatus(): Promise<NativeRuntimeStatus>;
  /**
   * Searches current-profile eligible libraries without network access. An
   * implementation rejects with `too_large` rather than returning a partial
   * evidence set when one candidate has more than 100 evidence records.
   */
  findLocalArxiv(
    reference: ArxivUrlReference,
    limit: number,
  ): Promise<NativeLocalArxivDiscovery>;
  searchPapers(query: string, limit: number): Promise<NativePaperRecord[]>;
  getPdfAttachment(
    libraryId: string,
    attachmentKey: string,
    itemKey?: string,
  ): Promise<NativePdfAttachment | undefined>;
  readPdfPage(
    attachment: NativePdfAttachment,
    pageIndex: number,
  ): Promise<NativePdfPageRecord>;
  confirmInspectedRegion?(
    libraryId: string,
    attachmentKey: string,
    pageIndex: number,
  ): Promise<NativeInspectedRegionEvidence | undefined>;
  listAnnotations(
    libraryId: string,
    attachmentKey: string,
  ): Promise<NativeAnnotationRecord[]>;
  getAnnotation(
    libraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<NativeAnnotationRecord | undefined>;
  createAnnotation(input: NativeAnnotationCreate): Promise<NativeAnnotationRecord>;
  updateAnnotation(input: NativeAnnotationUpdate): Promise<NativeAnnotationRecord>;
  listNotes(libraryId: string, itemKey: string): Promise<NativeNoteRecord[]>;
  getNote(
    libraryId: string,
    itemKey: string,
    noteKey: string,
  ): Promise<NativeNoteRecord | undefined>;
  createNote(input: NativeNoteCreate): Promise<NativeNoteRecord>;
  updateNote(input: NativeNoteUpdate): Promise<NativeNoteRecord>;
  annotationVisible(
    libraryId: string,
    attachmentKey: string,
    annotationKey: string,
  ): Promise<boolean>;
  findByOperationMarker(marker: string): Promise<NativeMutationRecord[]>;
  inspectArxiv(source: ArxivSource): Promise<ArxivNativeInspection>;
  getArxivParent(
    source: ArxivSource,
    itemKey: string,
  ): Promise<NativeArxivParentRecord | undefined>;
  getArxivAttachment(
    source: ArxivSource,
    itemKey: string,
    attachmentKey: string,
  ): Promise<NativeArxivAttachmentRecord | undefined>;
  findArxivByOperationMarker(marker: string): Promise<NativeArxivOperationObject[]>;
}

export interface ZoteroLibraryAdapterOptions {
  native: ZoteroNativeApi;
  noteContent: NativeNoteContentPolicy;
  digest: import("../../ports/digest.js").PayloadDigestPort;
  profileId: string;
  pluginVersion: string;
  enabled: boolean;
  accessGate?: ZoteroAccessGate;
  transport: TransportDescription;
  /** Exact operations backed by the current production composition. */
  operations?: readonly import("../../protocol/types.js").OperationName[];
}

/** A single live gate can be shared by the protocol and privileged adapters. */
export interface ZoteroAccessGate {
  isEnabled(): boolean;
  /** Opaque generation captured before awaited mutation preparation. */
  capture(): string;
  /** True only while the same enabled authority generation remains live. */
  isCurrent(fence: string): boolean;
  setEnabled?(enabled: boolean): void;
}

export class MutableZoteroAccessGate implements ZoteroAccessGate {
  #enabled: boolean;
  #generation = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  capture(): string {
    return String(this.#generation);
  }

  isCurrent(fence: string): boolean {
    return this.#enabled && fence === String(this.#generation);
  }

  setEnabled(enabled: boolean): void {
    this.#generation += 1;
    this.#enabled = enabled;
  }
}
