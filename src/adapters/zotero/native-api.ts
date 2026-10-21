import type { ResolvedAnchor, TransportDescription } from "../../protocol/types.js";
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

/**
 * Narrow boundary around privileged Zotero globals. The library adapter owns
 * protocol policy; a host implementation owns native item and reader calls.
 */
export interface ZoteroNativeApi {
  runtimeStatus(): Promise<NativeRuntimeStatus>;
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
}

export interface ZoteroLibraryAdapterOptions {
  native: ZoteroNativeApi;
  digest: import("../../ports/digest.js").PayloadDigestPort;
  profileId: string;
  pluginVersion: string;
  enabled: boolean;
  accessGate?: ZoteroAccessGate;
  transport: TransportDescription;
}

/** A single live gate can be shared by the protocol and privileged adapters. */
export interface ZoteroAccessGate {
  isEnabled(): boolean;
  setEnabled?(enabled: boolean): void;
}

export class MutableZoteroAccessGate implements ZoteroAccessGate {
  #enabled: boolean;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  isEnabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }
}
